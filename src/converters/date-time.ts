import { DateTime, Duration } from 'luxon'

function dateFromDB(millis: string | null) {
  if (millis === null)
    throw new Error(
      'Date is null where it should not be. Check loader definition.',
    )
  return DateTime.fromMillis(Number.parseInt(millis, 10))
}

function dateToDB(datetime: DateTime) {
  if (datetime instanceof DateTime) return `${datetime.toMillis()}`
  throw new Error('Date is not luxon DateTime instance')
}

function durationFromDB(millis: string) {
  if (millis === null)
    throw new Error(
      'Date is null where it should not be. Check loader definition.',
    )
  return Duration.fromMillis(Number.parseInt(millis, 10))
}

function durationToDB(duration: Duration) {
  if (duration instanceof Duration) return `${duration.as('milliseconds')}`
  throw new Error('Duration is not luxon Duration instance')
}

export const dateConverter = () => ({
  fromDB: dateFromDB,
  toDB: dateToDB,
})

export const durationConverter = () => ({
  fromDB: durationFromDB,
  toDB: durationToDB,
})
