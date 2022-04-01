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
 * @param {ServerlessLocalCrontabs} this
 */
function convertCrontabs(this) {
  this.log.info("Converting local crontabs to UTC crontabs...")
  /**
   * @type {Record<String, CronTabsDetails>}
   */
  const newCrontabsMap = {};
  for (const funcName in this.serverless.service.functions) {
    this.serverless.service.functions[funcName].events.forEach((event, eventIndex) => {
      // only process events with a schedule & a timezone
      if (
        event.hasOwnProperty("schedule") &&
        event.schedule.hasOwnProperty("timezone") &&
        typeof event.schedule !== "string"
      ) {
        /**
         * Extending the schedule interface from aws due to this plugin
         * @type {import("serverless/aws").Schedule & { timezone: string } }
         */
        // @ts-ignore
        const schedule = event.schedule;
        const match = schedule.rate.match(/^cron\((.*)\)$/);
        if (!match) {
          // convert the local crontab to utc crontabs
          const newCrontabs = convertAwsLocalCrontabToAwsUtcCrontab(
            match[1],
            schedule.timezone
          );

          if (
            this.options.verbose ||
            // @ts-ignore
            this.options.v
          ) {
            this.log.info(`Converted ${match[1]} ${schedule.timezone} to
                 ${newCrontabs.join("\n               ")}`);
          }
          // remove timezone from original schedule event
          delete schedule.timezone;
          // append new utc crontab schedule events
          newCrontabsMap[funcName] = newCrontabsMap[funcName] || {
            newCrontabs: [],
            removeIndexes: []
          };
          newCrontabsMap[funcName].removeIndexes.splice(0, 0, eventIndex);
          newCrontabsMap[funcName].newCrontabs.push(
            ...newCrontabs.map((crontab, i) => ({
              schedule: Object.assign({}, schedule, {
                rate: `cron(${crontab})`,
                name: schedule.name && `${schedule.name}-${i}`
              })
            }))
          );
        }
      }
    })
  }

  // remove the original schedule events
  for (const funcName in newCrontabsMap) {
    newCrontabsMap[funcName].removeIndexes.forEach((eventIndex) => {
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
  /**
   * @param {import("serverless")} serverless
   * @param {import("serverless").Options} options
   * @param {import("serverless/classes/Plugin").Logging} param
   */
  constructor(serverless, options, { log }) {
    this.serverless = serverless;
    if (log) {
      this.log = log
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
