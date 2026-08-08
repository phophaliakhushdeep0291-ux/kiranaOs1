# MQA-BILL-01 restaurant add-on matrix

Date: 2026-08-08  
Shop: Saffron Table QA  
Bill evidence: `KOS-2026-000002` / `cmsk6at3c01zwq9ww72twfdu3`

The retained flow configures Truffle Paneer Flatbread with the Large portion at ₹590 and `Finish your plate: Smoked mozzarella` at +₹85. Checkout, synced bill history and final detail show exactly ₹675. Database integration separately proves the sold-line snapshot and exact dish, recipe and add-on ingredient consumption.

## Geometry and touch evidence

| Viewport | Add-on dialog | Checkout | Final detail | Active targets |
|---|---|---|---|---|
| 375x667 | 375/375, no internal overflow | document/dialog 375/375 | document 375/375; phone card 331/331 | 0 below 44px |
| 390x844 | 390/390, no internal overflow | document/dialog 390/390 | document 390/390; phone card 346/346 | 0 below 44px |
| 430x932 | 430/430, no internal overflow | document/dialog 430/430 | document 430/430; phone card 386/386 | 0 below 44px |
| 768x1024 | centered dialog 512px, content 510/510 | document/dialog 768/768 | document 768/768; table wrapper 660/660 | 0 below 44px |

Touch measurements are taken after the 200ms dialog zoom animation settles. The audit covers visible buttons, links, inputs and selects within the active task surface.

## Artifacts

Each viewport retains `addon-dialog`, `checkout` and `detail` PNGs in this directory. The browser pass visually inspected hierarchy and wrapping in addition to measuring document, dialog, card/table and active-control geometry.

This matrix closes the restaurant cash/add-on slice only. Dedicated Udhar checkout, explicit offline transition and physical printer evidence remain open release work.
