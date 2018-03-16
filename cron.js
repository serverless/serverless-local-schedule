const Cron = require('cron-converter');
const equal = require('deep-equal');
const timezoneJS = require('timezone-js');
const tzdata = require('tzdata');

// instantiate cron converter
const cron = new Cron();
// load timezone data
const _tz = timezoneJS.timezone;
_tz.loadingScheme = _tz.loadingSchemes.MANUAL_LOAD;
_tz.loadZoneDataFromObject(tzdata);


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

const localCrontabToUtcCrontabs = (localCrontab, timezone) => {
  const localArrayCrontab = cron.fromString(localCrontab).toArray();
  let utcArrayCrontabs = [];
  for (const month of localArrayCrontab[3]) {
    for (const day of localArrayCrontab[2]) {
      // For now don't handle the hour between 12-1 when DST shift usually occurs
      const localDate = new timezoneJS.Date(
        new Date().getFullYear(), month-1, day, 12, 0, timezone);
      const offsetHours = Math.floor(localDate.getTimezoneOffset() / 60);
      const offsetMinutes = localDate.getTimezoneOffset() % 60;
      utcArrayCrontabs.push([
        localArrayCrontab[0].map((minute) => minute - offsetMinutes),
        localArrayCrontab[1].map((hour) => hour - offsetHours),
        [day],
        [month],
        localArrayCrontab[4]
      ]);
    }
  }
  // Group days together by month & hour/minute.
  utcArrayCrontabs = utcArrayCrontabs.reduce((acc, crontabArray) => {
    if (acc.length > 0 // not the 1st element
        &&
        equal(acc[acc.length-1][0], crontabArray[0]) // minute the same
        &&
        equal(acc[acc.length-1][1], crontabArray[1]) // hour the same
        &&
        equal(acc[acc.length-1][3], crontabArray[3]) // month the same
       ) {
      acc[acc.length-1][2].push(...crontabArray[2]);
    } else {
      acc.push(crontabArray)
    }
    return acc;
  }, []);
  // Group months together by hour/minute & days
  utcArrayCrontabs = utcArrayCrontabs.reduce((acc, crontabArray) => {
    if (acc.length > 0 // not the 1st element
        &&
        equal(acc[acc.length-1][0], crontabArray[0]) // minute the same
        &&
        equal(acc[acc.length-1][1], crontabArray[1]) // hour the same
        &&
        equal(acc[acc.length-1][2], crontabArray[2]) // days the same
       ) {
      acc[acc.length-1][3].push(...crontabArray[3]);
    } else {
      acc.push(crontabArray)
    }
    return acc;
  }, []);
  // combine start & end of year if possible
  if (equal(utcArrayCrontabs[0][0], utcArrayCrontabs[utcArrayCrontabs.length-1][0])
      &&
      equal(utcArrayCrontabs[0][1], utcArrayCrontabs[utcArrayCrontabs.length-1][1]))
    utcArrayCrontabs[0][3].push(...utcArrayCrontabs.pop()[3]);
  // return converted back to crontabs from arrays
  return utcArrayCrontabs.map((arrayCrontab) => cron.fromArray(arrayCrontab).toString());
};

const convertAwsLocalCrontabToAwsUtcCrontab = (localCrontab, timezone) => {
  const {crontab, awsSpecificDetails} = convertAwsToStandardCrontab(localCrontab);
  const utcCrontabs = localCrontabToUtcCrontabs(crontab, timezone);
  return utcCrontabs.map((crontab) => convertStandardCrontabToAws({crontab, awsSpecificDetails}))
};

module.exports = {
  convertAwsLocalCrontabToAwsUtcCrontab,
  convertAwsToStandardCrontab,
  convertStandardCrontabToAws,
  localCrontabToUtcCrontabs,
};
