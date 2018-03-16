const {convertAwsLocalCrontabToAwsUtcCrontab} = require('./cron.js');

function convertCrontabs() {
  for (const funcName in this.serverless.service.functions) {
    for (const eventIndex in this.serverless.service.functions[funcName].events) {
      const event = this.serverless.service.functions[funcName].events[eventIndex];
      // only process events with a schedule & a timezone
      if (event.hasOwnProperty('schedule') && event.hasOwnProperty('timezone')) {
        const match = event.schedule.match(/^cron\((.*)\)$/);
        if (!match) // skip rate() schedules
          continue;
        // convert the local crontab to utc crontabs
        const newCrontabs = convertAwsLocalCrontabToAwsUtcCrontab(match[1], event.timezone);
        // remove the original schedule event
        this.serverless.service.functions[funcName].events.splice(eventIndex, 1);
        // append new utc crontab schedule events
        this.serverless.service.functions[funcName].events.push(...newCrontabs.map((crontab) => ({
          schedule: `cron(${crontab})`,
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


