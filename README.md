# MHC Cases List

Fetches the next day's Madras High Court daily cases list, filters the cases
where advocate **K.Chandrasekaran** appears (petitioner side, respondent side,
or in a connected case), and generates a tabular PDF in [pdfs/](pdfs/).

The PDF has a second page listing only the cases where **State Bank of India**
is a party; it is left empty when there are no such cases.

If the next day's list is not published (weekends, holidays, or before the
court uploads it), the PDF is still generated for that date with a
"no matching cases / no list published" note.

## Running locally

```bash
npm install
node mhc_cases.js        # or ./run.sh (macOS/Linux), run.bat (Windows)
```

The advocate name and how many days ahead to look are configured at the top of
[mhc_cases.js](mhc_cases.js) (`ADVOCATE_INPUT`, `DAYS_AHEAD`). All dates are
computed in IST regardless of the machine's timezone.
