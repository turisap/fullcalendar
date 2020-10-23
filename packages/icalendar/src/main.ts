import ICAL from 'ical.js'
import { __assign } from 'tslib'
import { createPlugin, EventSourceDef } from '@fullcalendar/common'
import { EVENT_SOURCE_REFINERS } from './event-source-refiners'

type Success = (rawFeed: string, xhr: XMLHttpRequest) => void
type Failure = (error: string, xhr: XMLHttpRequest) => void

export function requestICal(url: string, successCallback: Success, failureCallback: Failure) {

  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, true)

  xhr.onload = function() {
    if (xhr.status >= 200 && xhr.status < 400) {
      successCallback(xhr.responseText, xhr)
    } else {
      failureCallback('Request failed', xhr)
    }
  }

  xhr.onerror = () => failureCallback('Request failed', xhr)

  xhr.send(null)
}


interface ICalFeedMeta {
  feedUrl: string
  extraParams?: any
}


let eventSourceDef: EventSourceDef<ICalFeedMeta> = {

  parseMeta(refined) {
    if (refined.feedUrl) {
      return {
        feedUrl: refined.feedUrl,
      }
    }
    return null
  },

  fetch(arg, success, failure) {
    let meta: ICalFeedMeta = arg.eventSource.meta

    return new Promise((resolve, reject) => {
      requestICal(meta.feedUrl,
        (rawFeed, xhr) => {
          try {
            const iCalFeed = ICAL.parse(rawFeed)
            const iCalComponent = new ICAL.Component(iCalFeed);
            const vevents = iCalComponent.getAllSubcomponents("vevent");
            const events = vevents.map((vevent) => {
              try {
								const event = new ICAL.Event(vevent)

                if (event.startDate.isDate && event.endDate == null) {
                  return {
                    title: event.summary,
                    start: event.startDate.toJSDate(),
                    end: event.startDate.addDuration({days: 1}).toJSDate(),
                    allDay: true,
                  }
                } else if (event.startDate.isDate && event.endDate.isDate) {
                  return {
                    title: event.summary,
                    start: event.startDate.toJSDate(),
                    end: event.endDate.toJSDate(),
                    allDay: true,
                  }
                } else {
                  return {
                    title: event.summary,
                    start: event.startDate.toJSDate(),
                    end: event.endDate.toJSDate(),
                  }
                }
              } catch(error) {
                console.log(`Unable to process item in calendar: ${error}.`)
                return null
              }
            }).filter((item: any) => { return item !== null })

            success({ rawEvents: events, xhr })
            resolve()
          } catch(error) {
            console.log(error)
            throw error
          }
        },
        (errorMessage, xhr) => {
          failure({ message: errorMessage, xhr })
          reject()
        },
      )
    })
  }
}


export default createPlugin({
  eventSourceRefiners: EVENT_SOURCE_REFINERS,
  eventSourceDefs: [ eventSourceDef ]
})