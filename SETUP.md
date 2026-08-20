# Set up the START Command Center

This guide assumes you have never deployed a Google Apps Script web app. Deploy
from a durable, school-managed Storm King Google Workspace account that has
**Editor** access to the existing **START Control Center** Google Sheet. A
faculty sponsor or long-term program account is better than a graduating
student's personal account.

The source spreadsheet ID is:

```text
1XFTIrKIcckrwavS-tJ5E_fReKVR3BlLtsbLUXRhto6I
```

Do not create a second spreadsheet. The app is designed to be attached to this
existing one.

## 1. Open the Apps Script project

1. Open the **START Control Center** Google Sheet.
2. Confirm that its tabs include **Metrics**, **Tasks**, **Projects**,
   **Updates**, **Settings**, and **Members**.
3. In the Sheet menu, choose **Extensions → Apps Script**.
4. If Google asks, give the script project a name such as
   `START Command Center`.

Opening Apps Script this way creates a script bound to the spreadsheet. That is
useful because the project stays with the workbook. Google does not make a
bound script's `getActiveSpreadsheet()` method available when it runs as a web
app, so `Code.gs` opens the supplied workbook ID explicitly. A spreadsheet ID
identifies the file; it is not a password and does not grant access by itself.
Google permissions still control every read and write.

For details, see Google's notes on
[bound-script special methods](https://developers.google.com/apps-script/guides/bound#special_methods).

## 2. Copy the two project files

### Code.gs

1. In the Apps Script editor, open the existing **Code.gs** file.
2. If it contains the previously deployed START Command Center code, replace
   that file's full contents with this repository's `apps-script/Code.gs`. If it
   contains only Google's empty starter function, delete the starter content.
3. If it instead contains unrelated automation, stop and ask the Sheet owner to
   back it up and confirm how the files should be combined; do not erase it.

### Index.html

1. If **Index.html** already contains the deployed dashboard, replace its full
   contents with this repository's `apps-script/Index.html`.
2. If it does not exist, click **+** beside **Files**, choose **HTML**, and enter
   the name `Index` (Apps Script adds `.html`).
3. Copy all of the repository file into the Apps Script file.

Click **Save project**. The project now has the two required app source files,
`Code.gs` and `Index.html`. Existing, owner-approved automation files can remain.

## 3. Prepare member profiles and the project workflow

Run the safe setup helpers after copying the newest `Code.gs` and before
publishing it. Neither helper rewrites a task, project, or update data row.

1. Confirm `Members` has the headers `Email`, `Display Name`, and `Active`. The
   live workbook already has this tab. If another copy does not, run
   `setupMembersSheet` once from the Apps Script function menu.
2. Keep one row per committee member: a unique school email, the name the
   dashboard should show, and `TRUE` in **Active**. Use `FALSE` to remove a
   former member from the selector without deleting history.
3. In the Apps Script function menu, select `setupProjectWorkflow` and click
   **Run**. Approve access if Google asks. The helper appends only these missing
   headers to `Projects`:

   - `Validation Evidence`
   - `Success Measure`
   - `School Contact`
   - `Known Concerns`
   - `Decision Notes`
   - `Completed Work`
   - `Observed Result`

4. The same helper changes only the **Project Stage Options** setting to:

   ```text
   Idea | Validation | School Review | Active | Completed | Paused | Rejected
   ```

Running `setupProjectWorkflow` again is safe: it reports that setup is already
complete and adds no duplicate columns. Do not rewrite legacy project rows. The
app reads `Proposal Ready` as `School Review` and `Pilot` as `Active`; the next
intentional project action writes a current stage.

## 4. Choose the prototype access model

For the fastest school prototype, use this configuration:

- **Execute as:** Me (the deploying account)
- **Who has access:** Only users in The Storm King School's Google Workspace
  domain

This lets the app use the deployer's access to the Sheet. In this mode Google
often does not expose each visitor's email to the script, so the app displays
the active-member profile selector. That behavior is expected.

Do **not** choose anonymous/public access: this app can write to the committee's
operational Sheet. If no school-domain access option appears, stop and ask the
school's Google Workspace administrator rather than selecting a broader option.

If the school wants account-based identity immediately, choose **Execute as:
User accessing the web app** and keep access limited to the school domain. Each
member will need **Editor** access to the Sheet and will see Google authorization
on first use. Apps Script can then usually provide the school email, although
Google documents that email availability can still depend on security policy.
The member selector remains available as a fallback when Google does not expose
an email.

Keep the deployment owned by a durable school account. Google notes that a
versioned deployment's ownership does not automatically transfer, and a
deployment can stop working if its deploying account is deleted. See
[Google's deployment guidance](https://developers.google.com/apps-script/concepts/deployments#transfer_ownership_of_a_project).

## 5. Deploy the web app

1. In Apps Script, click **Deploy → New deployment**.
2. Next to **Select type**, click the settings/gear icon.
3. Choose **Web app**.
4. Enter a description such as `START Command Center v0.1`.
5. Select the execution and access settings from the previous section.
6. Click **Deploy**.
7. If Google asks for authorization, choose the account that owns or can edit
   the Sheet, review the requested access, and approve it.
8. Copy the **Web app URL**. The shareable deployed URL normally ends in
   `/exec`.

Google's current reference is
[Deploy a script as a web app](https://developers.google.com/apps-script/guides/web).

## 6. Open and check the dashboard

1. Open the copied `/exec` URL in a new browser tab.
2. Confirm that the header says **START Command Center**.
3. If the Sheet is empty, confirm the Tasks and Projects views show friendly
   empty messages instead of errors.
4. If the app asks for a profile, choose your name from the active rows in
   `Members`. The browser remembers that choice on the same device.
5. If Google recognizes your email but no display name is configured, use the
   offered **Set display name** action. It creates or updates only your Members
   profile.

The fallback selector is attribution, not strong authentication. On a shared
device, use **Switch profile** before claiming or updating a task and clear the
browser's site data when handing the device to someone else.

## 7. Verify the task and project workflows

### Task workflow

Create one temporary verification row in **Tasks**, then delete it when the
check is finished. Use an existing real task only when every test transition is
also genuine committee work:

- **Task ID:** `SETUP-CHECK-DELETE`
- **Task:** `Verify START dashboard deployment`
- **Status:** `Open`

Leave the other cells blank. Then:

1. Refresh the web app and open **Tasks**.
2. Confirm the task appears under **Open**.
3. Click **Claim Task**.
4. Return to the Sheet and confirm **Status** is `Doing` and **Claimed By**
   contains the stable member identity.
5. In the app, choose **Add Update**, enter a short answer to **What did you
   do?**, and save it.
6. Choose **Mark Blocked**, enter a short answer to **What are you waiting
   for?**, and confirm the task becomes `Blocked`.
7. Choose **Resume Work** and confirm the task returns to `Doing` and its active
   blocker clears. The earlier blocker should remain in the Updates history.
8. Mark it **Done**.
9. In the Sheet, confirm the final task values persist and new rows appeared in
   **Updates**.
10. Refresh the app and confirm the task remains Done and a recent update is
   visible on Home.
11. Open **Projects** and confirm any real project rows appear.

If you created the temporary row, delete that task row and only its matching
`SETUP-CHECK-DELETE` update rows after the test. Do not leave test data in the
operational workbook.

### Project workflow

Prefer using a genuine, small student idea so verification becomes useful
committee work. If you must use temporary data, give it an unmistakable name
such as `SETUP PROJECT CHECK — DELETE`, and remove only that project's row and
its matching Tasks/Updates rows immediately afterward.

1. Open **Projects** and click **+ New Idea**.
2. Enter a project name, the observed problem or opportunity, and an optional
   short note. Confirm the new row has a generated **Project ID**, Stage `Idea`,
   and a matching creation row in **Updates**.
3. Open the project and choose **Start Validation**. Confirm its Stage becomes
   `Validation`.
4. Enter concise evidence, a success measure, the school contact or department,
   known concerns, local feasibility, and any relevant START metric. Choose
   **Ready for School Review** only when this reflects real committee work.
5. For a temporary check, **Needs More Information** is the safer validation
   outcome; confirm the project stays in `Validation` and its missing information
   becomes the visible **Next Action**.
6. For a genuine approved project, continue through **School Review**, record
   the consulted department and feedback, then choose **Approved**. Confirm the
   project becomes `Active`.
7. From an Active project, add one task and confirm it appears in the Tasks Open
   pool with no owner. Post a project update and confirm it appears in the same
   existing **Updates** tab.
8. Complete only a genuinely finished project. Confirm completed work, observed
   result, and any Results Link persist while related tasks/history remain.

## 8. Publish later code changes without changing the URL

Saving code does not update an existing `/exec` deployment automatically.
Do not click **New deployment** for this revision.

1. Click **Deploy → Manage deployments**.
2. Select the current web app and click **Edit**.
3. Choose **New version**.
4. Add a short description and click **Deploy**. The existing `/exec` URL stays
   the same because you edited the current deployment.

For editor-only testing, **Deploy → Test deployments → Web app** provides a
`/dev` URL that runs the latest saved code. Google limits that URL to people who
can edit the script; continue sharing the `/exec` URL with committee members.

## Troubleshooting

### “Required sheet … was not found”

Confirm `Code.gs` still contains the spreadsheet ID shown at the top of this
guide, the deployment account can open that Sheet, and the `Tasks`, `Projects`,
`Updates`, `Settings`, `Metrics`, and `Members` tab names have not been changed
or deleted. If only `Members` is missing, run `setupMembersSheet` once from the
editor.

### “Missing required column …”

Do not add a new database. Compare the header row with the expected existing
headers. The app accepts several small naming variations, but these are the
current workbook headers used by the MVP:

- **Tasks:** `Task ID`, `Task`, `Related Project`, `Related Metric`,
  `Interest Tag`, `Estimated Time`, `Due Date`, `Status`, `Claimed By`,
  `Last Update`, `Blocker`, `Supporting Link`
- **Projects:** `Project ID`, `Project Name`, `Problem / Opportunity`,
  `Linked START Metrics`, `Carbon Track`, `Stage`, `START Impact`,
  `START Difficulty`, `START Cost`, `Local Feasibility`, `Recommendation`,
  `School Feedback`, `Next Action`, `Project Lead`, `Results Link`, `Validation
  Evidence`, `Success Measure`, `School Contact`, `Known Concerns`, `Decision
  Notes`, `Completed Work`, `Observed Result`
- **Updates:** `Timestamp`, `Member`, `Task / Project`, `Update`, `Blocker`,
  `Next Step`, `Link`
- **Metrics:** `Metric` (the selector also uses `Category` when present)
- **Settings:** `Setting`, `Value`, `Notes`
- **Members:** `Email`, `Display Name`, `Active`

If the app reports that project workflow setup is needed, do not type the new
headers into existing data columns. Run `setupProjectWorkflow` once from the
Apps Script function menu, then refresh the web app. The helper appends only
missing workflow headers and safely updates the one project-stage setting.

### A member cannot write

Confirm the member has an active row in `Members`. If the deployment executes
as the accessing user, also give that school account **Editor** access to the
Sheet and have the member authorize the app. For the quick prototype, redeploy
as the deploying account and keep access restricted to the school domain.

### A change is not visible

Save both source files, create a **new version** under **Manage deployments**,
and refresh the `/exec` URL. Use the `/dev` test deployment only while an editor
is checking the newest saved code.
