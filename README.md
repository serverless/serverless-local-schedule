# Serverless Local Schedule
[![serverless](http://public.serverless.com/badges/v3.svg)](http://www.serverless.com)
[![npm](https://img.shields.io/npm/v/serverless-local-schedule.svg)](https://www.npmjs.com/package/serverless-local-schedule)

This plugin allows you to specify a timezone on your lambdas triggered by AWS CloudWatch Events.

--- 

_Originally developed by [**Capital One**](https://www.capitalone.com/tech/open-source/), now maintained in scope of Serverless, Inc_

_Capital One considers itself the bank a technology company would build. It's delivering best-in-class innovation so that its millions of customers can manage their finances with ease. Capital One is all-in on the cloud and is a leader in the adoption of open source, RESTful APIs, microservices and containers. We build our own products and release them with a speed and agility that allows us to get new customer experiences to market quickly. Our engineers use artificial intelligence and machine learning to transform real-time data, software and algorithms into the future of finance, reimagined._

--- 

## Install

```
sls plugin install -n serverless-local-schedule
```

For example:
```yaml
functions:
  hello:
    handler: handler.hello
    events:
      - schedule:
          rate: cron(0 10 * * ? *)
          timezone: America/New_York
```

It works by converting that into 6 different schedules, effectively the same as having the following
configuration:
```yaml
functions:
  hello:
    handler: handler.hello
    events:
      - schedule:
          rate: cron(0 15 * 1-2,12 ? *) # full non-DST months
      - schedule:
          rate: cron(0 15 1-10 3 ? *) # non-DST portion of March
      - schedule:
          rate: cron(0 14 11-31 3 ? *) # DST portion of March
      - schedule:
          rate: cron(0 14 * 4-10 ? *) # full DST months
      - schedule:
          rate: cron(0 14 1-3 11 ? *) # DST portion of November
      - schedule:
          rate: cron(0 15 4-31 11 ? *) # non-DST portion of November
```

**NOTE:** The `- schedule: cron(* * * * ? *)` short syntax isn't supported.

**NOTE:** Unfortunately you cannot specify day of the week in the cron expression i.e. `cron(0 7 ? * MON-FRI *)`. This is because to support the split months (March & November in the US), the plugin has to specify a day of month (EG: November 1-3 in 2018), so you cannot specify a DOW other than `?` unfortunately. Recommended workaround for this is to move the day of week check into your code so it's just a no-op on non weekdays for instance.
