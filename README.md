# MHC Cause List

Fetches the next day's Madras High Court daily cause list, filters the cases
where advocate **K.Chandrasekaran** appears (petitioner side, respondent side,
or in a connected case), and generates a tabular PDF in [pdfs/](pdfs/).

## Automation

The GitHub Actions workflow [.github/workflows/daily.yml](.github/workflows/daily.yml)
runs every day at **8:00 PM IST** (14:30 UTC), generates the PDF for the next
day's list, and commits it to the `pdfs/` folder. It can also be run manually
from the Actions tab (workflow_dispatch).

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
