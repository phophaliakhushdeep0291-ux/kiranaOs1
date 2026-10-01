# Prescription entry recovery — 30 September 2026

## Reproduced counter problem

Starting a prescription, entering the doctor, patient, medicine, dosage and
notes, visiting Home and returning erased the entire entry. Corrections used
the same component-local state, which was also discarded when the counter lock
unmounted the page.

## Change

New entries and corrections now use the existing login/location-scoped counter
draft store. The panel and every entered field return on navigation or unlock.
Corrections retain their original register identity and cannot silently become
a new prescription or dispense it again. A second entry cannot overwrite the
open draft.

Saving freezes the fields and close actions; the shared pending state prevents
another submission even if the page remounts. Failure retains the entry for
correction. Successful saves, Cancel and sign-out clear it. A late save response
cannot start billing after the login or location has changed.

Patient and medication details remain in the active tab's memory. They are not
written to a durable draft on the shared device. Refresh, closing the tab and
sign-out therefore still discard unsaved prescriptions; the form explains this
in English and Hindi. Serial-intake and tester restart recovery is separate.

## Verification

- Frontend `npm run prod:check`: typecheck, English/Hindi placeholder parity,
  production build, bundle and production app checks passed; 3,107 tests passed,
  one existing skip.
- Focused prescription/counter recovery, pharmacy settle checks and specialist
  billing handoff suites: 45 tests passed. New regressions cover field recovery,
  correction identity, pending submission protection, failed-save recovery,
  cancellation, scope isolation and sign-out without disk persistence.
- The production preview on port 5501 and API on port 3007 were verified to run
  from this worktree, using synthetic shops in
  `/tmp/bug064-final-browser-test.db`.
- Browser walkthrough: the filled new prescription survived Home → register
  navigation with the billing checkbox still off. Saving created RX-000003
  once; an independent database query confirmed one matching pending entry and
  no refills used. A new entry was blank after success and after cancellation.
- A correction to RX-000003 retained quantity 2, the changed note and the same
  register identity after the same navigation. Counter-lock unmount and pending
  request behavior are covered by the regression suite.

## Evidence

- [Recovered new entry](evidence/prescription-recovery-2026-09-30/after-navigation.png)
- [Recovered field values](evidence/prescription-recovery-2026-09-30/after-navigation.txt)
- [Recovered correction](evidence/prescription-recovery-2026-09-30/correction-after-navigation.txt)

No backend schema or dispensing rules change in this patch. This is evidence
for the prescription workflow, not a new certification of all business types.
