# Attachments

Each customer can upload multiple files of any type to a private R2 bucket and attach their IDs to a chat message. Messages without text use the client caption “Attached files”. Canonical metadata and immutable retry payloads retain file names, types, sizes, and download links. Discord receives the same file links, so it does not impose its own attachment-upload limit on customer files.

## Deployment

1. Apply migration `0007_attachments.sql` after `0006_email_schedule.sql`.
2. Create a private R2 bucket in each environment. Add `"r2_buckets": [{"binding":"ATTACHMENTS","bucket_name":"your-bucket"}]` to that environment in Wrangler.
3. Do not enable public `r2.dev` access or add object expiration/lifecycle rules. This feature does not create retention rules or impose a product file-size cap. R2 multipart and Workers request limits still apply. R2 may clean up unfinished multipart uploads under its platform/default policy; completed objects are retained.
4. Deploy the API before updated SDKs. Test upload, interrupted retry, download, and Discord links with your own test files.

Uploads are authenticated and installation-scoped. The API validates part lengths, completion, message ownership, and immutable file association. Multipart streaming keeps file bytes out of JSON/workflow history and avoids whole-file Worker memory buffering. Parts are normally 8 MiB and scale for R2's 10,000-part maximum; very large parts remain subject to the account's Worker request limit.

The bucket stays private. Download URLs contain 256-bit random capabilities and remain valid without expiration, allowing access from private Discord threads and customer transcripts. Treat them as confidential: anyone given a link can download that file. Downloads always use `Content-Disposition: attachment`, `application/octet-stream`, `nosniff`, and a sandbox CSP, including HTML/SVG/executable files. No file-type filter or inline active-content renderer is used.

A completed upload is retained if removed from the draft; it is inaccessible through its download URL until associated with a message. Explicit cancellation aborts only an unfinished multipart upload. There is no automatic object deletion.

HTTP flow: authenticated `POST /v1/attachments` with a stable client upload ID and metadata; `PUT /v1/attachments/:id/parts/:part` for binary chunks; `POST /v1/attachments/:id/complete`; send the returned ID in `attachmentIds` with the message. Repeat the same upload ID/file to recover a lost completion response. The API returns links in `message.attachments` and mirrors them to Discord. Operator/email-originated binary uploads are not part of the client import flow.
