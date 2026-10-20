# Agenda views are addresses, built without a calendar library

The Agenda shows Agenda Items as a list (the default), a week or a month. Each view and period has its own address (`/agenda?vue=semaine&date=2026-10-20`), so going back, sharing and reloading work, and the last view picked is remembered in the browser. The week is seven day columns, each listing its items with their time, and on phones the days are stacked. There is no hourly grid: an over-40 audience reads a dated list better than a timeline of small blocks, and a Candidate rarely has more than a few items a day. The month is a plain `<table>` grid of days with a marker per item, and choosing a day lists its items below the grid. Dates are shown with `Intl` in French time (Europe/Paris), as Interviews and Job Digests already are. We add no date or calendar package. The add and edit forms open in the `@radix-ui/react-dialog` we already have (ADR-0018).

## Considered Options

- **A calendar component** (FullCalendar, react-big-calendar): these give a ready hourly grid and drag and drop, but they bring their own styles, which conflict with our token-only CSS (ADR-0018). They also have a weak keyboard and screen-reader story for an audience we hold to ADR-0009.
- **Radix Tabs for the three views**: the views are not panels of one page but different addresses with their own navigation (previous, today, next), so links styled as a segmented control fit better.
- **A date library** (date-fns-tz, luxon): it is not needed while everything is shown in a single time zone.

## Consequences

- Week and month are computed in Europe/Paris, and weeks start on Monday. A Candidate abroad still sees French time.
- Keyboard support for the month grid is plain Tab through its day buttons, not arrow-key grid navigation. Revisit this only if testing with Candidates shows a need.
