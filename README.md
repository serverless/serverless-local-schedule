# Serverless Local Schedule
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm](https://img.shields.io/npm/v/serverless-local-schedule.svg)](https://www.npmjs.com/package/serverless-local-schedule)


This plugin allows you to specify a timezone on your lambdas triggered by AWS CloudWatch Events.

To install:
```
sls plugin install -n serverless-local-schedule
```

For example:
```yaml
functions:
  hello:
    handler: handler.hello
    events:
      - schedule: cron(0 10 * * ? *)
        timezone: America/New_York
```

It works by converting that into 6 different schedules, effectively the same as having the following
configuration:
```yaml
functions:
  hello:
    handler: handler.hello
    events:
      - schedule: cron(0 5 * 1-2,12 ? *) # full non-DST months
      - schedule: cron(0 5 1-10 3 ? *) # non-DST portion of March
      - schedule: cron(0 6 11-31 3 ? *) # DST portion of March
      - schedule: cron(0 6 * 4-10 ? *) # full DST months
      - schedule: cron(0 6 1-3 11 ? *) # DST portion of November
      - schedule: cron(0 5 4-31 11 ? *) # non-DST portion of November
```
