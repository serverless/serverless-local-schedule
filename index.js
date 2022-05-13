const { localCrontabToUtcCrontabs } = require("local-crontab");
const { timezones } = require("timezone-enum/src/timezones.json")

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
const convertAwsToStandardCrontab = awsCrontab => {
  const crontabParts = awsCrontab.split(/\s+/);

  // standard crontabs don't have a year
  const year = crontabParts.pop();

  // replace ? with *, but remember where they were
  const questionParts = [];
  for (const i in crontabParts) {
    if (crontabParts[i] === "?") {
      questionParts.push(i);
      crontabParts[i] = "*";
    }
  }

  return {
    crontab: crontabParts.join(" "),
    awsSpecificDetails: {
      year,
      questionParts
    }
  };
};

const convertStandardCrontabToAws = ({ crontab, awsSpecificDetails }) => {
  const parts = crontab.split(/\s+/);
  for (const questionPart of awsSpecificDetails.questionParts) {
    parts[questionPart] = parts[questionPart].replace(/\*/, "?");
  }
  parts.push(awsSpecificDetails.year);
  return parts.join(" ");
};

const convertAwsLocalCrontabToAwsUtcCrontab = (localCrontab, timezone) => {
  const { crontab, awsSpecificDetails } = convertAwsToStandardCrontab(
    localCrontab
  );
  const utcCrontabs = localCrontabToUtcCrontabs(crontab, timezone);
  return utcCrontabs.map(crontab =>
    convertStandardCrontabToAws({ crontab, awsSpecificDetails })
  );
};

function convertCrontabs() {
  this.serverless.cli.log("Converting local crontabs to UTC crontabs...");
  const newCrontabsMap = {};
  for (const funcName in this.serverless.service.functions) {
    for (const eventIndex in this.serverless.service.functions[funcName]
      .events) {
      const event = this.serverless.service.functions[funcName].events[
        eventIndex
      ];
      // only process events with a schedule & a timezone
      if (
        event.hasOwnProperty("schedule") &&
        event.schedule.hasOwnProperty("timezone")
      ) {
        const schedule = event.schedule;
        const ratesAreArray = Array.isArray(schedule.rate);

        const rates = ratesAreArray ? schedule.rate : [schedule.rate];
        const matches = rates
          .map(rate => rate.match(/^cron\((.*)\)$/))
          .filter(match => match && match[1])

        if (!matches.length)
          // skip rate() schedules
          continue;
        // convert the local crontab to utc crontabs
        const newCrontabs = matches.flatMap(match => {
          const convertedCrontabs = convertAwsLocalCrontabToAwsUtcCrontab(
            match[1],
            schedule.timezone
          );

          if (this.options.verbose || this.options.v) {
            this.serverless.cli.log(`Converted ${match[1]} ${schedule.timezone} to
               ${convertedCrontabs.join("\n               ")}`);
          }

          return convertedCrontabs;
        })

        // remove timezone from original schedule event
        delete schedule.timezone;
        // append new utc crontab schedule events
        newCrontabsMap[funcName] = newCrontabsMap[funcName] || {
          newCrontabs: [],
          removeIndexes: []
        };
        newCrontabsMap[funcName].removeIndexes.splice(0, 0, eventIndex);
        newCrontabsMap[funcName].newCrontabs.push(
          ...newCrontabs.map((crontab, i) => {
            // When the rates are an array, the version of Serverless being used
            // is one that doesn't support named schedules when there are multiple
            // schedules or rates. See https://github.com/serverless/serverless/issues/9867 for details.
            const addName = !ratesAreArray && schedule.name;

            return ({
              schedule: Object.assign({}, schedule, {
                rate: `cron(${crontab})`,
                name: addName ? `${schedule.name}-${i}` : undefined,
              })
            });
          })
        );
      }
    }
  }

  // remove the original schedule events
  for (const funcName in newCrontabsMap) {
    newCrontabsMap[funcName].removeIndexes.forEach(eventIndex => {
      this.serverless.service.functions[funcName].events.splice(eventIndex, 1);
    });
  }

  for (const funcName in newCrontabsMap) {
    this.serverless.service.functions[funcName].events.push(
      ...newCrontabsMap[funcName].newCrontabs
    );
  }
}

class ServerlessLocalCrontabs {
  constructor(serverless, options) {
    this.serverless = serverless;
    if (
      this.serverless.configSchemaHandler &&
      this.serverless.configSchemaHandler.defineFunctionEventProperties
    ) {
      // Create schema for your properties. For reference use https://github.com/ajv-validator/ajv
      this.serverless.configSchemaHandler.defineFunctionEventProperties('aws', 'schedule', {
        properties: {
          timezone: {
            enum: timezones
          },
        },
      });
    }

    this.options = options;
    this.hooks = {
      "before:package:initialize": convertCrontabs.bind(this)
    };
  }
}

module.exports = ServerlessLocalCrontabs;
