# FQ-Lite

Version **0.4.0-preview.1** · one owner, encrypted browser vault · Windows / Node 24

Download or copy the complete application folder. Keep an encrypted backup before replacing application files. To preserve an existing browser workspace, keep the same browser profile, protocol, hostname, port and application path. A different address opens separate browser storage; restore your encrypted backup there if needed.

1. Open a terminal in this folder and run `node serve.mjs`.
2. Open `http://127.0.0.1:4178/` in Edge or Chrome. Review the Terms of Service and choose **I agree** to continue.
3. For existing books, unlock with the current vault password. For new books, enter a company name and a password of at least 12 characters, or choose **Restore backup**.
4. After opening the workspace, use **Company setup → Download backup** and keep the encrypted file and password separately. The local server serves application files; business records remain in the browser's encrypted vault.

![Create the encrypted owner workspace](setup-assets/create-workspace.png)

Keep the terminal open while using the local app. The service worker supports offline use after the application assets have loaded successfully. Update and reopen at the same address to receive new application assets. New owner desk records are added only when you first save a workflow; opening an older vault does not rewrite its financial records or identifiers. If a save reports that another session changed the vault, unlock or reload and review the current records before trying again.

This edition has one operator and no employee or shared platform accounts. The complete versioned customer manual, workflow screenshots and support index are delivered through the separate private knowledge base. They are excluded from this public application repository. Current payroll remains a federal preview with final output blocked.

## Code license and official terms

First-party JavaScript/module, HTML markup, CSS and build/test script code in this repository is covered. See [LICENSE](LICENSE) for the standard MIT grant ([upstream text](https://opensource.org/license/mit)). Names, logos, other branding, artwork, screenshots, user records, third-party material, legal documents (terms, privacy text and license/notice texts), and substantive legal text embedded in source are excluded from this code grant. No third-party rights are claimed. Separate component licenses and notices remain applicable.

Acceptance applies to this official build or service. It does not limit rights granted by the MIT source-code license or any separate component license. The official agreement remains separate and is available from the app’s Terms of Service control. See THIRD-PARTY-NOTICES.md for the shipping audit.
