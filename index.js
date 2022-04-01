const { localCrontabToUtcCrontabs } = require("local-crontab");
const { timezones } = require("timezone-enum/src/timezones.json");

/**
 * @typedef AwsSpecificCrontabDetails
 * @property {String} year
 * @property {Array<String>} questionParts
 */

/**
 * @typedef AWSCrontabDetails
 * @property {String} crontab
 * @property {AwsSpecificCrontabDetails} awsSpecificDetails
 */

/**
 * @typedef CronTabsDetails
 * @property {Array<Number>} removeIndexes
 * @property {Array<import("serverless/aws").Event>} newCrontabs
 */

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
 * @param {String} awsCrontab
 * @returns {AWSCrontabDetails}
 *
 */
const convertAwsToStandardCrontab = (awsCrontab) => {
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

/**
 * Use the information collected from previous conversion to convert back to aws crontab
 * @param {AWSCrontabDetails} param0
 * @returns {String}
 */
const convertStandardCrontabToAws = ({ crontab, awsSpecificDetails }) => {
  const parts = crontab.split(/\s+/);
  for (const questionPart of awsSpecificDetails.questionParts) {
    parts[questionPart] = parts[questionPart].replace(/\*/, "?");
  }
  parts.push(awsSpecificDetails.year);
  return parts.join(" ");
};

/**
 * @param {String} localCrontab
 * @param {String} timezone
 * @returns {Array<String>}
 */
const convertAwsLocalCrontabToAwsUtcCrontab = (localCrontab, timezone) => {
  const { crontab, awsSpecificDetails } =
    convertAwsToStandardCrontab(localCrontab);
  const utcCrontabs = localCrontabToUtcCrontabs(crontab, timezone);
  return utcCrontabs.map((crontab) =>
    convertStandardCrontabToAws({ crontab, awsSpecificDetails })
  );
};

/**
 * @param {String} rate
 * @param {String} timezone
 * @returns {Array<string> | undefined}
 */
const matchAndGenerateCronTabs = (rate, timezone) => {
  const match = rate.match(/^cron\((.*)\)$/);
  if (match) {
    return convertAwsLocalCrontabToAwsUtcCrontab(
      match[1],
      timezone
    )
  }
  return undefined
}

/**
 * @param {ServerlessLocalCrontabs} plugin
 */
function convertCrontabs(plugin = this) {
  /**
   * @type {Boolean}
   */
  // @ts-ignore
  const doVerboseLogging = plugin.options.verbose || plugin.options.v
  plugin.log.info("Converting local crontabs to UTC crontabs...")
  /**
   * @type {Record<String, CronTabsDetails>}
   */
  const newCrontabsMap = {};
  for (const funcName in plugin.serverless.service.functions) {
    plugin.serverless.service.functions[funcName].events.forEach((event, eventIndex) => {
      // only process events with a schedule & a timezone
      if (
        event.hasOwnProperty("schedule") &&
        event.schedule.hasOwnProperty("timezone") &&
        typeof event.schedule !== "string"
      ) {
        /**
         * Extending the schedule interface from aws due to this plugin
         * @type {import("serverless/aws").Schedule & { timezone?: string } }
         */
        const schedule = event.schedule;
        /**
         * @type {String[] | String[][]}
         */
        let newCrontabs = [];
        if (Array.isArray(schedule.rate)) {
          newCrontabs = schedule.rate.map(r => {
            const newVal = matchAndGenerateCronTabs(r, schedule.timezone)
            if (newVal !== undefined && doVerboseLogging) {
              plugin.log.info(
                `Converted ${r} ${schedule.timezone} to ${newVal.join("\n               ")}`
              );
            }
            return newVal
          }).filter(r => r !== undefined)
        }
        else {
          newCrontabs = matchAndGenerateCronTabs(schedule.rate, schedule.timezone)
          if (doVerboseLogging && newCrontabs) {
            plugin.log.info(
              `Converted ${schedule.rate} ${schedule.timezone} to ${newCrontabs.join("\n               ")}`
            );
          }
        }
        if (newCrontabs.length !== 0) {
          // remove timezone from original schedule event
          delete schedule.timezone;
          // append new utc crontab schedule events
          newCrontabsMap[funcName] = newCrontabsMap[funcName] || {
            newCrontabs: [],
            removeIndexes: []
          };
          newCrontabsMap[funcName].removeIndexes.splice(0, 0, eventIndex);
          newCrontabsMap[funcName].newCrontabs.push(
            ...newCrontabs.map(
              /**
               * 
               * @param {String | String[]} crontab 
               * @param {Number} i 
               * @returns {import("serverless/plugins/aws/provider/awsProvider").Event}
               */
              (crontab, i) => ({
                schedule: Object.assign({}, schedule, {
                  rate: typeof crontab === "string" ? `cron(${crontab})` : crontab.map(c => `cron(${c})`),
                  name: schedule.name && `${schedule.name}-${i}`
                })
              })
            )
          );
        }
      }
    })
  }

  // remove the original schedule events
  for (const funcName in newCrontabsMap) {
    newCrontabsMap[funcName].removeIndexes.forEach((eventIndex) => {
      plugin.serverless.service.functions[funcName].events.splice(eventIndex, 1);
    });
  }

  for (const funcName in newCrontabsMap) {
    plugin.serverless.service.functions[funcName].events.push(
      ...newCrontabsMap[funcName].newCrontabs
    );
  }
}

class ServerlessLocalCrontabs {
  /**
   * @param {import("serverless")} serverless
   * @param {import("serverless").Options} options
   * @param {import("serverless/classes/Plugin").Logging | undefined} loggingModule
   */
  constructor(serverless, options, loggingModule) {
    this.serverless = serverless;
    if (loggingModule && loggingModule.log) {
      this.log = loggingModule.log
    }
    else if (serverless.cli.log) {
      this.log = {
        /**
         * @param {String} message
         */
        info: (message) => {
          serverless.cli.log(message)
        }
      }
    }
    else {
      this.log = {
        /**
         * @param {String} message
         */
        info: (message) => {
          console.log(message)
        }
      }
    }
    if (
      this.serverless.configSchemaHandler &&
      this.serverless.configSchemaHandler.defineFunctionEventProperties
    ) {
      // Create schema for your properties. For reference use https://github.com/ajv-validator/ajv
      this.serverless.configSchemaHandler.defineFunctionEventProperties(
        "aws",
        "schedule",
        {
          properties: {
            timezone: {
              enum: timezones
            }
          }
        }
      );
    }
    this.options = options;
    this.hooks = {
      "before:package:initialize": convertCrontabs.bind(this)
    };
  }
}

module.exports = ServerlessLocalCrontabs;
