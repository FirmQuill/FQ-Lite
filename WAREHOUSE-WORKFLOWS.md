# FirmQuill Lite warehouse tools

In **Assets & pallets**, allocate existing ledger stock to a tracked unit. These tools run locally and offline after the app has cached:

- **Print label** shows a human-readable tracking ID, unit name, stock location and current shelf/bin. Print from the dialog on your operating system’s configured printer. This label does not encode a barcode; an existing keyboard-style scanner can still enter compatible IDs.
- **Set bin** assigns a shelf within the unit’s ledger location without posting stock. A location move clears the current shelf until it is assigned again, even if the unit comes back.
- **Record lot / serial** annotates packed products. Serial rows represent one item and cannot be active twice for that product in the same company. Use **Release trace** with a reason after confirming the identified product is no longer packed; the record stays in history. Expiry is a review indicator, not an automatic stock removal, and the trace list flags discrepancies after unpacking or counts. A trace is not a regulatory recall certificate or a substitute for verifying physical inventory.
- **Set reorder rule** uses current stock in a named ledger location. At or below the threshold, the suggestion is the difference to the target. Zero threshold and target disables the rule. Suggestions do not create commitments or send orders.

Regular sales, movements and approved counts remain the only stock-changing workflows. Metadata travels inside the same encrypted vault backup and compatible portable transfers. Test workflows with sample inventory before using operational data.
