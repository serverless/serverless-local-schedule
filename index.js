const {localCrontabToUtcCrontabs} = require('local-crontab');


/**
 * Convert an AWS CloudWatch crontab to a standard crontab.
 *
 * Main differences are:
 *    * A year field
 *    * ? instead of * sometimes
 *    * Some others.. implementation TBD
 *
 *  The data that is removed is returned as well so that it can be used to
 *  roundtrip back to an AWS CloudWatch crontab
 *
 */
const convertAwsToStandardCrontab = (awsCrontab) => {
  const crontabParts = awsCrontab.split(/\s+/);

  // standard crontabs don't have a year
  const year = crontabParts.pop();

  // replace ? with *, but remember where they were
  const questionParts = [];
  for (const i in crontabParts) {
    if (crontabParts[i] === '?') {
      questionParts.push(i);
      crontabParts[i] = '*';
    }
  }

  return {
    crontab: crontabParts.join(' '),
    awsSpecificDetails: {
      year,
      questionParts,
    },
  };
};


const convertStandardCrontabToAws = ({crontab, awsSpecificDetails}) => {
  const parts = crontab.split(/\s+/);
  for (const questionPart of awsSpecificDetails.questionParts) {
    parts[questionPart] = parts[questionPart].replace(/\*/, '?');
  }
  parts.push(awsSpecificDetails.year);
  return parts.join(' ');
};


const convertAwsLocalCrontabToAwsUtcCrontab = (localCrontab, timezone) => {
  const {crontab, awsSpecificDetails} = convertAwsToStandardCrontab(localCrontab);
  const utcCrontabs = localCrontabToUtcCrontabs(crontab, timezone);
  return utcCrontabs.map((crontab) => convertStandardCrontabToAws({crontab, awsSpecificDetails}))
};


function convertCrontabs() {
  this.serverless.cli.log('Converting local crontabs to UTC crontabs...');
  for (const funcName in this.serverless.service.functions) {
    for (const eventIndex in this.serverless.service.functions[funcName].events) {
      const event = this.serverless.service.functions[funcName].events[eventIndex];
      // only process events with a schedule & a timezone
      if (event.hasOwnProperty('schedule') && event.schedule.hasOwnProperty('timezone')) {
        const schedule = event.schedule;
        const match = schedule.rate.match(/^cron\((.*)\)$/);
        if (!match) // skip rate() schedules
          continue;
        // convert the local crontab to utc crontabs
        const newCrontabs = convertAwsLocalCrontabToAwsUtcCrontab(match[1], schedule.timezone);
        // remove the original schedule event
        this.serverless.service.functions[funcName].events.splice(eventIndex, 1);
        if (this.options.verbose || this.options.v) {
          this.serverless.cli.log(`Converted ${match[1]} ${schedule.timezone} to
               ${newCrontabs.join('\n               ')}`);
        }
        // remove timezone from original schedule event
        delete schedule.timezone;
        // append new utc crontab schedule events
        this.serverless.service.functions[funcName].events.push(...newCrontabs.map((crontab) => ({
          schedule: Object.assign({}, schedule, {rate: `cron(${crontab})`}),
        })))
      }
    }
  }
}

class ServerlessLocalCrontabs {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:package:initialize': convertCrontabs.bind(this),
    };
  }
}

module.exports = ServerlessLocalCrontabs;


