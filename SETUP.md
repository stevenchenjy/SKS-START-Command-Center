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
2. Confirm that its tabs include **Tasks**, **Projects**, **Updates**, and
   **Settings**. (`Metrics` can remain unused.)
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
2. If it contains only Google's empty starter function, delete that starter
   content. If it contains real automation, stop and ask the Sheet owner to
   back it up and confirm how these files should be combined; do not erase it.
3. Copy all of this repository's `apps-script/Code.gs` into the empty file.

### Index.html

1. Beside **Files**, click **+** and choose **HTML**.
2. Enter the name `Index` (Apps Script adds `.html`).
3. Copy all of this repository's `apps-script/Index.html` into that file.

Click **Save project**. A new project now has the two required source files,
`Code.gs` and `Index.html`. Existing, owner-approved automation files can remain.

## 3. Choose the prototype access model

For the fastest school prototype, use this configuration:

- **Execute as:** Me (the deploying account)
- **Who has access:** Only users in The Storm King School's Google Workspace
  domain

This lets the app use the deployer's access to the Sheet. In this mode Google
often does not expose each visitor's email to the script, so the app displays
the temporary member selector/name field. That behavior is expected.

Do **not** choose anonymous/public access: this app can write to the committee's
operational Sheet. If no school-domain access option appears, stop and ask the
school's Google Workspace administrator rather than selecting a broader option.

If the school wants account-based identity immediately, choose **Execute as:
User accessing the web app** and keep access limited to the school domain. Each
member will need **Editor** access to the Sheet and will see Google authorization
on first use. Apps Script can then usually provide the school email, although
Google documents that email availability can still depend on security policy.
The member selector remains available as a fallback.

Keep the deployment owned by a durable school account. Google notes that a
versioned deployment's ownership does not automatically transfer, and a
deployment can stop working if its deploying account is deleted. See
[Google's deployment guidance](https://developers.google.com/apps-script/concepts/deployments#transfer_ownership_of_a_project).

## 4. Deploy the web app

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

## 5. Open and check the dashboard

1. Open the copied `/exec` URL in a new browser tab.
2. Confirm that the header says **START Command Center**.
3. If the Sheet is empty, confirm the Tasks and Projects views show friendly
   empty messages instead of errors.
4. If the app asks **Who's working?**, choose your name from `Settings`. The
   browser remembers that choice on the same device.

If the Student Lead is the only choice, that matches the workbook's current
Settings data. Before other students claim tasks, add a normal Settings row such as
`Committee Members` in the **Setting** column and names separated by `|` in the
**Value** column. This configuration is required for members whose Google email
is not available; no column change is required.

The selector is temporary attribution, not strong authentication. On a shared
device, confirm the selected name before claiming or updating a task and clear
the browser's site data when handing the device to someone else.

## 6. Verify one complete read/write flow

Create one temporary verification row in **Tasks**, then delete it when the
check is finished. Use an existing real task only when every test transition is
also genuine committee work:

- **Task ID:** `SETUP-CHECK-DELETE`
- **Task:** `Verify START dashboard deployment`
- **Status:** `Open`

Leave the other cells blank. Then:

1. Refresh the web app and open **Tasks**.
2. Confirm the task appears under **Open**.
3. Click **Claim task**.
4. Return to the Sheet and confirm **Status** is `Claimed` and **Claimed By**
   contains the selected member.
5. In the app, set the task to **In Progress** and save a short update.
6. Set it to **Waiting**, add a short blocker, and save.
7. Mark it **Done**.
8. In the Sheet, confirm the final task values persist and new rows appeared in
   **Updates**.
9. Refresh the app and confirm the task remains Done and a recent update is
   visible on Home.
10. Open **Projects** and confirm any real project rows appear.

If you created the temporary row, delete that task row and only its matching
`SETUP-CHECK-DELETE` update rows after the test. Do not leave test data in the
operational workbook.

## 7. Publish later code changes

Saving code does not update an existing `/exec` deployment automatically.

1. Click **Deploy → Manage deployments**.
2. Select the current web app and click **Edit**.
3. Choose **New version**.
4. Add a short description and click **Deploy**.

For editor-only testing, **Deploy → Test deployments → Web app** provides a
`/dev` URL that runs the latest saved code. Google limits that URL to people who
can edit the script; continue sharing the `/exec` URL with committee members.

## Troubleshooting

### “Required sheet … was not found”

Confirm `Code.gs` still contains the spreadsheet ID shown at the top of this
guide, the deployment account can open that Sheet, and the `Tasks`, `Projects`,
`Updates`, and `Settings` tab names have not been changed or deleted.

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
  `School Feedback`, `Next Action`, `Project Lead`, `Results Link`
- **Updates:** `Timestamp`, `Member`, `Task / Project`, `Update`, `Blocker`,
  `Next Step`, `Link`
- **Settings:** `Setting`, `Value`, `Notes`

### A member cannot write

If the deployment executes as the accessing user, give that school account
**Editor** access to the Sheet and have the member authorize the app. For the
quick prototype, redeploy as the deploying account and keep access restricted
to the school domain.

### A change is not visible

Save both source files, create a **new version** under **Manage deployments**,
and refresh the `/exec` URL. Use the `/dev` test deployment only while an editor
is checking the newest saved code.
