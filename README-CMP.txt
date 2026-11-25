GarlicTransfer - Console Finder, Editor Tree and Replace File
Source: GitHub main f36b80541c13d280ba08c38b2ea85fa1410e7618
The upstream app version values are preserved.

INSTALL
Close GarlicTransfer. Merge the update ZIP's resources folder into the resources
folder of the matching installation, replacing app.asar and poc/dt_resign.py.
Run GarlicTransfer normally. The PS5 helper binaries are unchanged.

WINDOWS RESIGN DATABASE FIX
Resign metadata reads close their SQLite connections before returning or
retrying with a local copy. The resign tests also close their fixture and result
connections before temporary-folder cleanup. This fixes Windows metadata.db
file locks without suppressing cleanup errors. The resign files match the
reported CI commit 23c7d02746d1cf58959fea1411d8d49d215e6674 before this fix.

FIND PLAYSTATIONS
Locate PS5 lists each discovered console's name, type, IPv4, firmware,
Console ID and saved pairing status.
Choose JB for the local helper. This fills both JB helper PS5 IPv4 and Local
oracle IP; it does not change Use GarlicWorker or the transfer console.
Choose OFW for the transfer console: Source PS5 for PS5 to PC, Receiving PS5
for PC to PS5. Scanning alone does not assign a console or start a transfer.
Settings / Oracle / Maximum JB firmware defaults to 13.60. PS5s at or below
the limit can be selected as JB; higher or unknown firmware cannot. Set a
new limit, such as 14.22, and Save Settings when a newer firmware is supported.
Manual IPv4 discovery uses the same list. Existing selections are kept during
rescans, and console roles are locked while a transfer or save job is active.
Pairing shows Paired for this firmware, Pair again for pairing saved on another
firmware, Not paired when none is saved, or Unknown if it cannot be checked.
Pairing retains the 32-byte approval value from the console's Data Transfer
request, keyed by Console ID and firmware. Connections use the current IPv4;
the saved pairing is selected by identity rather than by its address.

FINDER CLEANUP
Console details are normalized before selecting roles or comparing identity.
Console ID capitalization and extra spaces in Type do not change selection.
If an IP reports another console, the list, sidebar and pairing panel require
an OFW selection again before starting a transfer. Existing files are retained.
Settings and the finder share the same maximum-JB-firmware validation.
Pairing statuses use a single lookup batch for each refresh and update their
cells directly. The pairing format and handshake are unchanged.
Paired indicators use the selected skin's success color.
Changing the discovered firmware clears cached live-transfer approval so the
next transfer starts a fresh session. A prepared upload uses the new firmware
and fresh-session flags while retaining its selected user, files and metadata.
Settings saves preserve newer firmware-limit edits made while saving, and late
results from older saves cannot replace the latest status or draft.

EDITOR FILE TREE
Edit your save now groups decrypted files into expandable folders.
Right-click a file and choose Replace file to select a replacement on your PC.
The selected workspace file keeps its original name and folder location.
Cancel leaves it unchanged. Replacing the file currently open in the editor
asks before discarding unsaved text; edits to another open file are retained.
Replacement also supports files larger than the text/hex editor limit.
Use Save & encrypt or Export files to keep the updated save.

LOCAL PC SAVES
In Local files / My Saves, choose Local PC in the Console selector.
Click Browse folder and choose Saves/<USER>/PPSA##### or Saves/PPSA#####.
A parent containing Saves, a user folder or a single PPSA folder also works.
The selected folder and source are remembered. No transfer metadata is needed.
Saves without a user folder appear under Unassigned.
These folders must contain encrypted PS5 saves; arbitrary files are not saves.
Save & encrypt replaces the selected PC save after making a recovery backup.
Matching .bin sidecars stay associated with their save container.
Upload to PS5 stages all recognized encrypted files in the selected PPSA folder.
Choose the actual destination PS5 user in the upload dialog; a PC user-folder
name only groups files and does not set the account ID.
The editor More-menu fix and upstream save context-menu styles are included.

ZIP DROP DECRYPTION
Drop one encrypted save ZIP onto Decrypt another save to start decryption.
The same button still opens the file picker. The current Use GarlicWorker
setting selects remote or local processing, just like the picker workflow.
Existing workspace changes still require confirmation before replacement.
The original ZIP stays in place. Busy or closing apps do not queue a new job.

LOCAL SAVE PROCESSING
With Use GarlicWorker off, Decrypt/Encrypt/Resign use your local PS5.
Enter the local PS5 IPv4 address and start its ELF payload listener on 9021.
Local mode does not require a Server URL or server key.
With Use GarlicWorker on, the existing Server URL and key are used instead.
The bundled combined helper provides transfer keys on 9022 and local save
jobs on 9023. It is sent when needed; an existing compatible helper is reused.
Local inputs are packed and validated before helper startup. Each file and
its complete packed archive must fit below 4 GiB.
Results become available only after complete receipt and successful completion.
The saved-account updates do not change the helper binary or save-processing code.

SAVED ACCOUNTS
The current account appears beside the target selector in the save screens.
Known accounts show their saved name; hover over it to see the full hex ID.
Accounts without a saved name still show their hex ID.
Add current ID opens a Name dialog. Enter a name and press Save or Enter.
Cancel or Escape closes it without adding an account.
Settings / Saved accounts has Account ID, Name and Remove columns in its own
scroll area. Type directly in the Name field; it saves after a short pause.
Enter or leaving the field saves immediately. There is no separate Edit button.
Saving keeps the same text box, focus, caret and any newer text being typed.
Failed name saves keep your draft and show the error beside that name.
Other accounts can still save. Press Enter or edit the failed name to retry.
Errors from an older request do not invalidate newer text. Corrected names
continue saving, and reverting to the saved name clears the obsolete error.
Names are limited to 64 characters. Add and Rename show "Name already in use."
for matching names, ignoring capitalization and surrounding spaces.
Blank names use the Account ID. Existing lists remain readable.
Failed additions keep the Name dialog open for correction and retry.
Confirmation prompts use a native app dialog to avoid the Windows input-focus
issue associated with browser confirm pop-ups. Cancel keeps the current data.
Choose Display name or Account ID for the target selector in Settings.
Use current ID starts checked and keeps the save's existing account when
encrypting. Uncheck it to choose a saved target, or leave Choose account
selected to enter a target ID manually in the save action.
The target applies to Encrypt, Save & encrypt and Resign in local and remote
modes. Save & encrypt applies the target during encryption; no separate resign
step is needed. These controls are also available before decrypting a save.
Removing the selected account restores Use current ID. Checking Use current ID
remembers your saved target for when you uncheck it again.
The list, names, display preference and target selection are saved automatically
in account-list.json in the application's user-data folder. Existing saved
accounts remain available after updating the app.
Closing or quitting waits for pending account-name saves. If saving fails,
choose Keep editing to correct it, or Discard unsaved names and close.
New transfers, discovery and imports wait while the final name saves finish.
Existing jobs can complete normally. Keeping the app open restores controls.
Close checks follow the current app page after a reload; old replies are ignored.
An unreadable account-list.json is preserved in an exclusive recovery backup
before a later change replaces it. Failed backups prevent replacement.
Recovery files are beside it, named account-list.json.recovery-<id>.bak.
Recovery retries recheck the source before replacement. If it was manually
changed or repaired, saving stops and asks you to restart GarlicTransfer.

LOCAL ADDITIONS CLEANUP
- Transfers and save editing share helper startup and connection checks.
- Cancel stops the app request and waits for cleanup before another save job.
- Remote deadlines cover uploads, status requests, polling and result downloads.
- A busy helper port waits for readiness without deploying another helper.
- Inactive Local PC folders avoid scans; user filters reuse loaded inventory.
- Refresh and file operations still validate current files and selected titles.
- Workspace details and account IDs share one folder walk without stale caching.
- Edited files use unique staging; failed writes preserve the original file.
- Add files checks conflicting names before copying and rolls back its new
  files if copying or the final workspace refresh fails.
- Failed Local PC exports and upload preparation clean up their owned files.
- Generated temporary files are released after their consumers finish; open
  workspaces remain available while editing, exporting or running save jobs.
- Original saves, recovery backups and user-selected folders are preserved.
- Existing temporary folders from earlier app sessions are not swept.
- Function notes remain short, such as Function Workspace Scan.

Cancel or timeout closes the app request. A PS5 or remote worker may finish
its current processing after the app disconnects.
Save changes updates the decrypted workspace; encrypt or export files to keep
those edits. Closing or replacing a generated workspace releases its temporary
files after confirmation, including confirmation for unencrypted saved edits.

EXTERNAL SKINS
Choose a skin in the left sidebar below USER - source saves.
The skin selector and small Open/Reload buttons are sidebar-only; the
Appearance card has been removed from Settings. Garlic Classic remains available.
Spicy Garlic, Chill Onion, Onion, Green Onion and Evil Onion are included.
Each now uses skin.json and mascot.png; all share one tree stylesheet.
The sidebar Open button opens %root%/Skins beside GarlicTransfer.exe.
External skins now load only from that folder. Copy any existing AppData
skin folders into it to keep using them; nothing is moved automatically.
Copy the provided skin-template/my-onion folder into that opened folder.
Edit its skin.json name/colors and replace mascot.png with your PNG.
Click Reload in the sidebar, then select My Onion. No rebuild is needed.
Skin files contain data and PNG only.
Missing colors use light/dark defaults. Bad files report a message while
other skins load. Missing artwork uses the Spicy Garlic mascot. Low-contrast
text palettes fall back to readable defaults. A removed selected skin shows
Garlic Classic without deleting the saved preference.

INCLUDED FOLDER CHANGES
Saves/<user-id>/<PPSA or CUSA>/<encrypted-save-files>
Transfer-Metadata/ (databases, manifests and transfer metadata)
Other Needed Data/ (support files, backups and staging)
Save folders contain payloads only; existing legacy layouts remain readable.
Multi-file Add save folder uploads and short function notes remain included.
The tree uses the existing Garlic download, upload, editor, import/export
and resign workflows. Source-user filters do not change upload destination.
CMP Fix All, complete-save staging and completion tracking are not added.

SKIN OPTIMIZATIONS
- Mascots load only for the selected skin, rather than every listed skin.
- Unchanged definitions and artwork reuse bounded caches.
- Edited, deleted and invalid files are rechecked with normal fallback behavior.
- Same-layout skin changes and Settings navigation do not rebuild save trees.
- Scroll, focus, expanded branches and selections stay in place for color changes.
- Warnings have a separate expandable list and stay visible after saving.
- Skin options sort by display name, with Garlic Classic first.
- Function notes use short identifiers such as Function Skin Loading.
- Existing skin format, %root%/Skins and NAME-TO-LONG remain supported.
- All previous skin, folder and upload changes are included.

TREE CLEANUP
- Files match exact normalized user, game title and entry ID; no cross-entry fallback.
- Shared tree adapters replace duplicate upload/local wiring and repeated searches.
- Upload checkbox changes update selection and labels without rebuilding trees.
- Unchanged tree data reuses existing DOM while callbacks use current records.
- Changed inventory restores expansion, scroll and matching focus when possible.
- Local/global busy state consistently controls filters and tree actions.
- Keyboard context menus open once; latest actions are used after refresh.
- Refreshing the same profile retains the selected save and current workspace.
- Older local inventory responses cannot replace newer results.
- Basic function notes remain, such as Function Tree Refresh.

INCLUDED TREE CLEANUP
- Collapsed branches stay remembered while user filters hide/show them.
- Branch memory is bounded and clears for a different console/profile.
- Hidden Classic save tables are skipped in tree mode and built from current
  data on return to Classic. Other-content tables remain available.
- Mascots that fail browser decoding fall back once to the bundled mascot.
- If the fallback also fails, the broken image hides with a sidebar warning.
- Escape and menu actions restore focus to the opening row when appropriate.
- Outside clicks, refresh and removed rows do not steal keyboard focus.
- Function notes remain basic, such as Function Menu Focus.
- All previous changes and external skin formats are included.

VALIDATION
121 Python tests passed locally after the resign database fix. Connection
checks cover normal reads, failed reads and both local-copy fallback outcomes.
The preceding editor/console-finder build passed all 528 Node tests; its
Electron files are unchanged by this fix. Windows CI still needs to be rerun.
The packaged Electron files match the tested source.
Name entry, automatic saving, Enter, Cancel/Escape, failed-save retry, focus,
caret retention and current-name tooltips are covered by DOM event tests.
Windows appearance and native input still need testing on your machine.
No live PS5 test performed.

CONTENTS
The update ZIP contains resources/app.asar and resources/poc/dt_resign.py.
The app.asar retains the previously tested editor and console-finder changes;
the Windows resign runtime fix is in poc/dt_resign.py.
The source ZIP opens directly at the project root, with source and tests.
skin-template/my-onion/: editable external add-in example.
poc/local_worker/: matching helper source and GPL license.

MASCOT LOADING FIX (v0.3.3)
Mascots remain invisible until their image load event. The reserved image
space prevents name/alt-text flashes and layout jumps, including fallback
loading. Unchanged loaded mascots stay visible on reload.
The mascot code matches the full-resources build from before the size cleanup.

CI DEPENDENCIES
The identity-check workflow installs locked development dependencies before
testing. This includes jsdom for the skin and tree tests. Install scripts
are skipped in that test job because the Electron binary is not needed.

WINDOWS DATABASE CLEANUP
SQLite readers and test fixtures close their connections explicitly, including
query failures. This releases database files before temporary-folder cleanup.
POSIX privilege tests run only on POSIX; Windows pairing behavior has a separate
test. All languages, plain title lists and original artwork are retained.
