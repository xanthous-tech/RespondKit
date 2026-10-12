# OF-19 thread flow verification

Run: 2026-10-12T13:01:45.533Z

Executed `node apps/api/scripts/verify-agent-api.mjs` against `wrangler dev --local`, using the real Hono Worker, D1 migrations 0000–0010, and MessageWorkflow. HTTP calls below were made with curl. A loopback Discord REST fixture captured posts; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.

## Repository verification

Executed on 2026-10-12 in the OF-19 worktree, with `VOLTA_FEATURE_PNPM=1` and Volta on PATH:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm check` | Formatting, lint and types passed |
| `pnpm test:all` | 379 tests in 43 files passed, including 142 API tests |
| `pnpm --filter @respondkit/web build` | Passed; existing bundle-size advisory only |
| `node apps/api/scripts/verify-agent-api.mjs` | Passed; 43 recorded HTTP calls, 13 fake Discord posts |

The API tests drive signed Ed25519 slash, button and message-context interactions through the real HTTP handler. They cover authorization, first decision wins, stale drafts after steering, all chunks of long drafts, note replay/conflicts/partial delivery, scheduled recovery, monotonic acknowledgement, late arrivals and cross-thread cursors. A full 100-message page also runs through a binding guard matching [D1’s 100-parameter ceiling](https://developers.cloudflare.com/d1/platform/limits/); bounded subqueries avoid expanding every ID into query parameters. Both the original 0008→0009 test and a populated 0009→0010 upgrade test pass. The latter compares all existing visitor, thread, message, customer transcript, draft and rate-limit rows before/after migration, then checks note/message ordering and draft invalidation.

Isolation tests compare the customer thread list, thread detail, statuses and shared widget/native message wire payloads before and after notes, validating the public protocol schemas. Separate assertions exercise customer read receipts, email enqueue/delivery, translation context and job rejection, and needsReply. Existing email, SDK, Discord and workflow tests run in the complete suite. Native simulator/device UI flows were not run; no native code or payload shape changed.

## English drafts and translation review

A workflow test submits `mode: "draft", translate: "customer"` with French as the known customer language, observes the English draft in Discord, approves through the context menu once, and reads the French customer-visible text from D1. Translation results are fixtures; no Gemini call is made.

The existing uncertain-translation path (`needsReview: true`) still requires **Approve translation** after draft approval. Tests confirm that gate and stale-draft refusal remain intact. Smallest proposed follow-up: prepare the translation before displaying the draft, show English plus translated text, and let one approval authorize both. This PR preserves the existing review gate instead of silently approving uncertain translations. This finding was reported on OF-19.

## Rollout and limits

Migration 0010 is new; migrations 0000–0009 are unchanged. Start agent transcript readers at cursor `0` after upgrade because timeline cursors now include notes. Scheduled note recovery uses the existing Worker schedule, bounded to 25 eligible notes per run; failed posts remain stored and may also be replayed with their original idempotency key.

Only local D1 migrations and loopback Discord fixtures were used. No production API calls, token-env loading, command registration, deployment or merge occurred. The front desk owns migration/deployment/registration after Simon merges. A non-author verdict must be attached to the final PR head before merge.

## Curl transcript

### POST /v1/client/sessions

HTTP 201

```json
{
  "session": {
    "id": "session_6cbbbbbb5cc349afa3adca48c72196e7",
    "token": "<redacted>",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "expiresAt": "2026-11-11T13:01:39.000Z"
  }
}
```

### POST /v1/threads

HTTP 201

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "clientThreadId": "of10-thread",
    "state": "open",
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:39.528Z"
  }
}
```

### POST /v1/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/messages

HTTP 202

```json
{
  "acceptance": {
    "messageId": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
    "clientMessageId": "of10-question",
    "status": "accepted"
  }
}
```

### GET /threads?needsReply=1&state=open

HTTP 200

```json
{
  "threads": [
    {
      "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
      "clientThreadId": "of10-thread",
      "status": "open",
      "customerReadCursor": 0,
      "customerLanguage": null,
      "customerLanguageUpdatedAt": null,
      "createdAt": "2026-10-12T13:01:39.528Z",
      "updatedAt": "2026-10-12T13:01:40.534Z",
      "lastActivityAt": "2026-10-12T13:01:40.534Z",
      "claimedBy": null,
      "claimExpiresAt": null,
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T13:01:40.534Z",
      "lastOperatorAt": null,
      "lastAgentAt": null,
      "agentCursor": "1",
      "acknowledgedCursor": "0",
      "visitor": {
        "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
        "workspaceId": "workspace_of10",
        "inboxId": "inbox_of10",
        "installationId": "of10-local-curl",
        "sessionVersion": 0,
        "externalUserId": "of10-customer",
        "email": "customer@example.test",
        "posthogDistinctId": null,
        "locale": "en",
        "timezone": null,
        "region": "US",
        "userAgent": "curl/8.7.1",
        "device": null,
        "metadata": {
          "platform": "web",
          "plan": "test"
        },
        "createdAt": "2026-10-12T13:01:39.507Z",
        "updatedAt": "2026-10-12T13:01:39.507Z",
        "lastSeenAt": "2026-10-12T13:01:39.507Z"
      },
      "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555"
    }
  ],
  "nextCursor": null
}
```

### GET /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "open",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:40.534Z",
    "lastActivityAt": "2026-10-12T13:01:40.534Z",
    "claimedBy": null,
    "claimExpiresAt": null,
    "closedAt": null,
    "state": "open"
  },
  "visitor": {
    "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "installationId": "of10-local-curl",
    "sessionVersion": 0,
    "externalUserId": "of10-customer",
    "email": "customer@example.test",
    "posthogDistinctId": null,
    "locale": "en",
    "timezone": null,
    "region": "US",
    "userAgent": "curl/8.7.1",
    "device": null,
    "metadata": {
      "platform": "web",
      "plan": "test"
    },
    "createdAt": "2026-10-12T13:01:39.507Z",
    "updatedAt": "2026-10-12T13:01:39.507Z",
    "lastSeenAt": "2026-10-12T13:01:39.507Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [
    {
      "rowId": 1,
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "workflowInstanceId": "customer_NOe_yuG0m9W5g3C_iI1gvKGvn0XGu6mNJSv2y5o04eI",
      "direction": "customer_to_operator",
      "attachments": [],
      "authorKind": null,
      "authorName": null,
      "originalText": "How can I export my transcript?",
      "originalLanguage": null,
      "replyTranslation": null,
      "replyTranslationRequest": null,
      "customerVisibleText": "How can I export my transcript?",
      "customerVisibleLanguage": "en",
      "operatorVisibleText": "How can I export my transcript?",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.534Z",
      "updatedAt": "2026-10-12T13:01:40.569Z",
      "sequence": "1",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [],
  "through": "1",
  "nextCursor": null,
  "activity": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/claim

HTTP 200

```json
{
  "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
  "claimExpiresAt": "2026-10-12T13:06:40.698Z"
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
  "mode": "send",
  "status": "approved",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": null,
  "failureCode": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
  "mode": "send",
  "status": "available",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": "succeeded",
  "failureCode": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
  "mode": "draft",
  "status": "pending",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": null,
  "failureCode": null
}
```

### GET /v1/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/messages

HTTP 200

```json
{
  "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
  "messages": [
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "state": "available"
    }
  ],
  "nextCursor": "3",
  "hasMore": false
}
```

### POST /v1/discord/interactions

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft approved for delivery. Repeated approval will not send another reply.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### GET /v1/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/messages

HTTP 200

```json
{
  "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
  "messages": [
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "state": "available"
    }
  ],
  "nextCursor": "4",
  "hasMore": false
}
```

### POST /v1/discord/interactions

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft approved; the reply is already available in chat.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### GET /threads?needsReply=1&state=open

HTTP 200

```json
{
  "threads": [],
  "nextCursor": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/notes

HTTP 201

```json
{
  "note": {
    "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "sequence": "4",
    "authorKind": "agent",
    "authorName": "Local helper",
    "operatorDiscordUserId": null,
    "kind": "reasoning",
    "text": "PRIVATE: inspect export settings before proposing a reply.",
    "createdAt": "2026-10-12T13:01:41.155Z",
    "discordMessageIds": [
      "600000000000000004"
    ]
  },
  "delivery": "posted"
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/notes

HTTP 200

```json
{
  "note": {
    "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "sequence": "4",
    "authorKind": "agent",
    "authorName": "Local helper",
    "operatorDiscordUserId": null,
    "kind": "reasoning",
    "text": "PRIVATE: inspect export settings before proposing a reply.",
    "createdAt": "2026-10-12T13:01:41.155Z",
    "discordMessageIds": [
      "600000000000000004"
    ]
  },
  "delivery": "posted"
}
```

### POST /v1/agent/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/notes

HTTP 409

```json
{
  "error": {
    "code": "conflict",
    "message": "Idempotency key belongs to another immutable note",
    "retryable": false
  }
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [
    {
      "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
      "clientThreadId": "of10-thread",
      "status": "open",
      "customerReadCursor": 0,
      "customerLanguage": null,
      "customerLanguageUpdatedAt": null,
      "createdAt": "2026-10-12T13:01:39.528Z",
      "updatedAt": "2026-10-12T13:01:40.848Z",
      "lastActivityAt": "2026-10-12T13:01:40.848Z",
      "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
      "claimExpiresAt": "2026-10-12T13:06:40.698Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T13:01:40.534Z",
      "lastOperatorAt": null,
      "lastAgentAt": "2026-10-12T13:01:41.155Z",
      "agentCursor": "4",
      "acknowledgedCursor": "0",
      "visitor": {
        "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
        "workspaceId": "workspace_of10",
        "inboxId": "inbox_of10",
        "installationId": "of10-local-curl",
        "sessionVersion": 0,
        "externalUserId": "of10-customer",
        "email": "customer@example.test",
        "posthogDistinctId": null,
        "locale": "en",
        "timezone": null,
        "region": "US",
        "userAgent": "curl/8.7.1",
        "device": null,
        "metadata": {
          "platform": "web",
          "plan": "test"
        },
        "createdAt": "2026-10-12T13:01:39.507Z",
        "updatedAt": "2026-10-12T13:01:39.507Z",
        "lastSeenAt": "2026-10-12T13:01:39.507Z"
      },
      "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555"
    }
  ],
  "nextCursor": null
}
```

### GET /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "open",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:40.848Z",
    "lastActivityAt": "2026-10-12T13:01:40.848Z",
    "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
    "claimExpiresAt": "2026-10-12T13:06:40.698Z",
    "closedAt": null,
    "state": "open"
  },
  "visitor": {
    "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "installationId": "of10-local-curl",
    "sessionVersion": 0,
    "externalUserId": "of10-customer",
    "email": "customer@example.test",
    "posthogDistinctId": null,
    "locale": "en",
    "timezone": null,
    "region": "US",
    "userAgent": "curl/8.7.1",
    "device": null,
    "metadata": {
      "platform": "web",
      "plan": "test"
    },
    "createdAt": "2026-10-12T13:01:39.507Z",
    "updatedAt": "2026-10-12T13:01:39.507Z",
    "lastSeenAt": "2026-10-12T13:01:39.507Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [
    {
      "rowId": 1,
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "workflowInstanceId": "customer_NOe_yuG0m9W5g3C_iI1gvKGvn0XGu6mNJSv2y5o04eI",
      "direction": "customer_to_operator",
      "attachments": [],
      "authorKind": null,
      "authorName": null,
      "originalText": "How can I export my transcript?",
      "originalLanguage": null,
      "replyTranslation": null,
      "replyTranslationRequest": null,
      "customerVisibleText": "How can I export my transcript?",
      "customerVisibleLanguage": "en",
      "operatorVisibleText": "How can I export my transcript?",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.534Z",
      "updatedAt": "2026-10-12T13:01:40.569Z",
      "sequence": "1",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 2,
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "Open the transcript and choose Export.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "Open the transcript and choose Export.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.711Z",
      "updatedAt": "2026-10-12T13:01:40.740Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 3,
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "You can export as text or subtitles.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "You can export as text or subtitles.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.848Z",
      "updatedAt": "2026-10-12T13:01:41.023Z",
      "sequence": "3",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "4",
      "authorKind": "agent",
      "authorName": "Local helper",
      "operatorDiscordUserId": null,
      "kind": "reasoning",
      "text": "PRIVATE: inspect export settings before proposing a reply.",
      "createdAt": "2026-10-12T13:01:41.155Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    }
  ],
  "through": "4",
  "nextCursor": null,
  "activity": null
}
```

### GET /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk?limit=2

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "open",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:40.848Z",
    "lastActivityAt": "2026-10-12T13:01:40.848Z",
    "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
    "claimExpiresAt": "2026-10-12T13:06:40.698Z",
    "closedAt": null,
    "state": "open"
  },
  "visitor": {
    "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "installationId": "of10-local-curl",
    "sessionVersion": 0,
    "externalUserId": "of10-customer",
    "email": "customer@example.test",
    "posthogDistinctId": null,
    "locale": "en",
    "timezone": null,
    "region": "US",
    "userAgent": "curl/8.7.1",
    "device": null,
    "metadata": {
      "platform": "web",
      "plan": "test"
    },
    "createdAt": "2026-10-12T13:01:39.507Z",
    "updatedAt": "2026-10-12T13:01:39.507Z",
    "lastSeenAt": "2026-10-12T13:01:39.507Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [
    {
      "rowId": 1,
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "workflowInstanceId": "customer_NOe_yuG0m9W5g3C_iI1gvKGvn0XGu6mNJSv2y5o04eI",
      "direction": "customer_to_operator",
      "attachments": [],
      "authorKind": null,
      "authorName": null,
      "originalText": "How can I export my transcript?",
      "originalLanguage": null,
      "replyTranslation": null,
      "replyTranslationRequest": null,
      "customerVisibleText": "How can I export my transcript?",
      "customerVisibleLanguage": "en",
      "operatorVisibleText": "How can I export my transcript?",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.534Z",
      "updatedAt": "2026-10-12T13:01:40.569Z",
      "sequence": "1",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 2,
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "Open the transcript and choose Export.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "Open the transcript and choose Export.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.711Z",
      "updatedAt": "2026-10-12T13:01:40.740Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [],
  "through": "2",
  "nextCursor": "2",
  "activity": null
}
```

### GET /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk?limit=2&cursor=2

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "open",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:40.848Z",
    "lastActivityAt": "2026-10-12T13:01:40.848Z",
    "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
    "claimExpiresAt": "2026-10-12T13:06:40.698Z",
    "closedAt": null,
    "state": "open"
  },
  "visitor": {
    "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "installationId": "of10-local-curl",
    "sessionVersion": 0,
    "externalUserId": "of10-customer",
    "email": "customer@example.test",
    "posthogDistinctId": null,
    "locale": "en",
    "timezone": null,
    "region": "US",
    "userAgent": "curl/8.7.1",
    "device": null,
    "metadata": {
      "platform": "web",
      "plan": "test"
    },
    "createdAt": "2026-10-12T13:01:39.507Z",
    "updatedAt": "2026-10-12T13:01:39.507Z",
    "lastSeenAt": "2026-10-12T13:01:39.507Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [
    {
      "rowId": 3,
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "You can export as text or subtitles.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "You can export as text or subtitles.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.848Z",
      "updatedAt": "2026-10-12T13:01:41.023Z",
      "sequence": "3",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "4",
      "authorKind": "agent",
      "authorName": "Local helper",
      "operatorDiscordUserId": null,
      "kind": "reasoning",
      "text": "PRIVATE: inspect export settings before proposing a reply.",
      "createdAt": "2026-10-12T13:01:41.155Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    }
  ],
  "through": "4",
  "nextCursor": null,
  "activity": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/ack

HTTP 200

```json
{
  "acknowledgedCursor": "4"
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [],
  "nextCursor": null
}
```

### GET /v1/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/messages

HTTP 200

```json
{
  "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
  "messages": [
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "state": "available"
    }
  ],
  "nextCursor": "4",
  "hasMore": false
}
```

### POST /v1/discord/interactions (unauthorized /agent)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "This command is not authorized in the current support thread.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /v1/discord/interactions (agent)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Steering note saved and posted. The agent can read it on its next poll.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /v1/discord/interactions (agent)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Steering note saved and posted. The agent can read it on its next poll.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [
    {
      "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
      "clientThreadId": "of10-thread",
      "status": "open",
      "customerReadCursor": 0,
      "customerLanguage": null,
      "customerLanguageUpdatedAt": null,
      "createdAt": "2026-10-12T13:01:39.528Z",
      "updatedAt": "2026-10-12T13:01:40.848Z",
      "lastActivityAt": "2026-10-12T13:01:40.848Z",
      "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
      "claimExpiresAt": "2026-10-12T13:06:40.698Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T13:01:40.534Z",
      "lastOperatorAt": "2026-10-12T13:01:41.314Z",
      "lastAgentAt": "2026-10-12T13:01:41.155Z",
      "agentCursor": "5",
      "acknowledgedCursor": "4",
      "visitor": {
        "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
        "workspaceId": "workspace_of10",
        "inboxId": "inbox_of10",
        "installationId": "of10-local-curl",
        "sessionVersion": 0,
        "externalUserId": "of10-customer",
        "email": "customer@example.test",
        "posthogDistinctId": null,
        "locale": "en",
        "timezone": null,
        "region": "US",
        "userAgent": "curl/8.7.1",
        "device": null,
        "metadata": {
          "platform": "web",
          "plan": "test"
        },
        "createdAt": "2026-10-12T13:01:39.507Z",
        "updatedAt": "2026-10-12T13:01:39.507Z",
        "lastSeenAt": "2026-10-12T13:01:39.507Z"
      },
      "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555"
    }
  ],
  "nextCursor": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/ack

HTTP 200

```json
{
  "acknowledgedCursor": "4"
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [
    {
      "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
      "clientThreadId": "of10-thread",
      "status": "open",
      "customerReadCursor": 0,
      "customerLanguage": null,
      "customerLanguageUpdatedAt": null,
      "createdAt": "2026-10-12T13:01:39.528Z",
      "updatedAt": "2026-10-12T13:01:40.848Z",
      "lastActivityAt": "2026-10-12T13:01:40.848Z",
      "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
      "claimExpiresAt": "2026-10-12T13:06:40.698Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T13:01:40.534Z",
      "lastOperatorAt": "2026-10-12T13:01:41.314Z",
      "lastAgentAt": "2026-10-12T13:01:41.155Z",
      "agentCursor": "5",
      "acknowledgedCursor": "4",
      "visitor": {
        "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
        "workspaceId": "workspace_of10",
        "inboxId": "inbox_of10",
        "installationId": "of10-local-curl",
        "sessionVersion": 0,
        "externalUserId": "of10-customer",
        "email": "customer@example.test",
        "posthogDistinctId": null,
        "locale": "en",
        "timezone": null,
        "region": "US",
        "userAgent": "curl/8.7.1",
        "device": null,
        "metadata": {
          "platform": "web",
          "plan": "test"
        },
        "createdAt": "2026-10-12T13:01:39.507Z",
        "updatedAt": "2026-10-12T13:01:39.507Z",
        "lastSeenAt": "2026-10-12T13:01:39.507Z"
      },
      "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555"
    }
  ],
  "nextCursor": null
}
```

### GET /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "open",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:40.848Z",
    "lastActivityAt": "2026-10-12T13:01:40.848Z",
    "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
    "claimExpiresAt": "2026-10-12T13:06:40.698Z",
    "closedAt": null,
    "state": "open"
  },
  "visitor": {
    "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "installationId": "of10-local-curl",
    "sessionVersion": 0,
    "externalUserId": "of10-customer",
    "email": "customer@example.test",
    "posthogDistinctId": null,
    "locale": "en",
    "timezone": null,
    "region": "US",
    "userAgent": "curl/8.7.1",
    "device": null,
    "metadata": {
      "platform": "web",
      "plan": "test"
    },
    "createdAt": "2026-10-12T13:01:39.507Z",
    "updatedAt": "2026-10-12T13:01:39.507Z",
    "lastSeenAt": "2026-10-12T13:01:39.507Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [
    {
      "rowId": 1,
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "workflowInstanceId": "customer_NOe_yuG0m9W5g3C_iI1gvKGvn0XGu6mNJSv2y5o04eI",
      "direction": "customer_to_operator",
      "attachments": [],
      "authorKind": null,
      "authorName": null,
      "originalText": "How can I export my transcript?",
      "originalLanguage": null,
      "replyTranslation": null,
      "replyTranslationRequest": null,
      "customerVisibleText": "How can I export my transcript?",
      "customerVisibleLanguage": "en",
      "operatorVisibleText": "How can I export my transcript?",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.534Z",
      "updatedAt": "2026-10-12T13:01:40.569Z",
      "sequence": "1",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 2,
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "Open the transcript and choose Export.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "Open the transcript and choose Export.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.711Z",
      "updatedAt": "2026-10-12T13:01:40.740Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 3,
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "agent",
      "authorName": "Local helper",
      "originalText": "You can export as text or subtitles.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "You can export as text or subtitles.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T13:01:40.848Z",
      "updatedAt": "2026-10-12T13:01:41.023Z",
      "sequence": "3",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "4",
      "authorKind": "agent",
      "authorName": "Local helper",
      "operatorDiscordUserId": null,
      "kind": "reasoning",
      "text": "PRIVATE: inspect export settings before proposing a reply.",
      "createdAt": "2026-10-12T13:01:41.155Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    },
    {
      "id": "note_discord_1559189316138172416",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "5",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "PRIVATE: ask which export format the customer needs.",
      "createdAt": "2026-10-12T13:01:41.314Z",
      "discordMessageIds": [
        "600000000000000005"
      ]
    }
  ],
  "through": "5",
  "nextCursor": null,
  "activity": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/ack

HTTP 200

```json
{
  "acknowledgedCursor": "5"
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [],
  "nextCursor": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
  "mode": "draft",
  "status": "pending",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": null,
  "failureCode": null
}
```

### POST /v1/discord/interactions (Approve draft)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft approved for delivery. Repeated approval will not send another reply.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /v1/discord/interactions (Reject draft)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft approved; the reply is already available in chat.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_f2407f85fce2e14e2526866f8ca1ac0be4f5952be60656601331675f6e4f337f",
  "mode": "draft",
  "status": "pending",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": null,
  "failureCode": null
}
```

### POST /v1/discord/interactions (Reject draft)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft rejected; no reply was sent.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /v1/discord/interactions (Approve draft)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Draft rejected; no reply was sent.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### POST /v1/discord/interactions (reply)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Queued for delivery as written. Reference: 1559189325357252608",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
}
```

### GET /threads?needsAgent=1

HTTP 200

```json
{
  "threads": [
    {
      "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
      "clientThreadId": "of10-thread",
      "status": "open",
      "customerReadCursor": 0,
      "customerLanguage": null,
      "customerLanguageUpdatedAt": null,
      "createdAt": "2026-10-12T13:01:39.528Z",
      "updatedAt": "2026-10-12T13:01:43.502Z",
      "lastActivityAt": "2026-10-12T13:01:43.502Z",
      "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
      "claimExpiresAt": "2026-10-12T13:06:40.698Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T13:01:40.534Z",
      "lastOperatorAt": "2026-10-12T13:01:43.502Z",
      "lastAgentAt": "2026-10-12T13:01:42.474Z",
      "agentCursor": "7",
      "acknowledgedCursor": "5",
      "visitor": {
        "id": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
        "workspaceId": "workspace_of10",
        "inboxId": "inbox_of10",
        "installationId": "of10-local-curl",
        "sessionVersion": 0,
        "externalUserId": "of10-customer",
        "email": "customer@example.test",
        "posthogDistinctId": null,
        "locale": "en",
        "timezone": null,
        "region": "US",
        "userAgent": "curl/8.7.1",
        "device": null,
        "metadata": {
          "platform": "web",
          "plan": "test"
        },
        "createdAt": "2026-10-12T13:01:39.507Z",
        "updatedAt": "2026-10-12T13:01:39.507Z",
        "lastSeenAt": "2026-10-12T13:01:39.507Z"
      },
      "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555"
    }
  ],
  "nextCursor": null
}
```

### GET /v1/threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/messages

HTTP 200

```json
{
  "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
  "messages": [
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T13:01:40.534Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T13:01:40.711Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T13:01:40.848Z",
      "state": "available"
    },
    {
      "id": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
      "acceptedAt": "2026-10-12T13:01:41.413Z",
      "state": "available"
    },
    {
      "id": "msg_MzGoK2V5I08p-KgsiINLK6ZEPK3Ci5WTZSbkY_FJaK0",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-12T13:01:43.502Z",
      "state": "available"
    }
  ],
  "nextCursor": "6",
  "hasMore": false
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/close

HTTP 200

```json
{
  "thread": {
    "id": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
    "workspaceId": "workspace_of10",
    "inboxId": "inbox_of10",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "clientThreadId": "of10-thread",
    "status": "closed",
    "customerReadCursor": 0,
    "customerLanguage": null,
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T13:01:39.528Z",
    "updatedAt": "2026-10-12T13:01:44.545Z",
    "lastActivityAt": "2026-10-12T13:01:43.502Z",
    "claimedBy": "agent_db85e7bcad893e4fe4b24de8584367be",
    "claimExpiresAt": "2026-10-12T13:06:40.698Z",
    "closedAt": "2026-10-12T13:01:44.545Z"
  }
}
```

## Discord posts captured

```json
[
  {
    "content": "**Customer**\nHow can I export my transcript?",
    "nonce": "ac-0-46a7719adff41e2e",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000000",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper**\n**Available in chat · sent as written**\nOpen the transcript and choose Export.",
    "nonce": "ac-0-5b26f83821a75030",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000001",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft**\nYou can export as text or subtitles.\n\nSend as written",
    "nonce": "ac-0-2243bb1ec9f2a9be",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve",
            "custom_id": "agent:approve:msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab"
          },
          {
            "type": 2,
            "style": 4,
            "label": "Reject",
            "custom_id": "agent:reject:msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000002",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper**\n**Available in chat · sent as written**\nYou can export as text or subtitles.",
    "nonce": "ac-0-84b4bc911957d854",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000003",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper** · reasoning\nPRIVATE: inspect export settings before proposing a reply.",
    "nonce": "ac-0-75d6a7fefb9688a8",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000004",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator Local operator** · steer\nPRIVATE: ask which export format the customer needs.",
    "nonce": "ac-0-d8abcd727ecb610e",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000005",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft**\nEnglish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approv",
    "nonce": "ac-0-d7b3937896b2f5b0",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000006",
    "channel_id": "555555555555555555"
  },
  {
    "content": "e draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. \n\nSend as written",
    "nonce": "ac-1-d7b3937896b2f5b0",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve",
            "custom_id": "agent:approve:msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6"
          },
          {
            "type": 2,
            "style": 4,
            "label": "Reject",
            "custom_id": "agent:reject:msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000007",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper**\n**Available in chat · sent as written**\nEnglish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. Engli",
    "nonce": "ac-0-778550ecf89c43e6",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000008",
    "channel_id": "555555555555555555"
  },
  {
    "content": "sh Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
    "nonce": "ac-1-778550ecf89c43e6",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000009",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft**\nEnglish Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Rej",
    "nonce": "ac-0-68e3f2cfc342afd1",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000010",
    "channel_id": "555555555555555555"
  },
  {
    "content": "ect draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. English Reject draft. \n\nSend as written",
    "nonce": "ac-1-68e3f2cfc342afd1",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve",
            "custom_id": "agent:approve:msg_agent_f2407f85fce2e14e2526866f8ca1ac0be4f5952be60656601331675f6e4f337f"
          },
          {
            "type": 2,
            "style": 4,
            "label": "Reject",
            "custom_id": "agent:reject:msg_agent_f2407f85fce2e14e2526866f8ca1ac0be4f5952be60656601331675f6e4f337f"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000011",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Available in chat · sent as written**\nHuman follow-up through the existing reply command.",
    "nonce": "ac-0-ac86dae324acb260",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000012",
    "channel_id": "555555555555555555"
  }
]
```

## D1 readback

```json
{
  "messagesAndDrafts": [
    {
      "status": "closed",
      "claimed_by": "agent_db85e7bcad893e4fe4b24de8584367be"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "author_kind": null,
      "author_name": null,
      "customer_visible_text": "How can I export my transcript?",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "author_kind": "agent",
      "author_name": "Local helper",
      "customer_visible_text": "Open the transcript and choose Export.",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "author_kind": "agent",
      "author_name": "Local helper",
      "customer_visible_text": "You can export as text or subtitles.",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
      "author_kind": "agent",
      "author_name": "Local helper",
      "customer_visible_text": "English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_MzGoK2V5I08p-KgsiINLK6ZEPK3Ci5WTZSbkY_FJaK0",
      "author_kind": "operator",
      "author_name": null,
      "customer_visible_text": "Human follow-up through the existing reply command.",
      "processing_status": "succeeded"
    },
    {
      "status": "approved",
      "decided_by": "444444444444444444"
    }
  ],
  "threadFlow": [
    {
      "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "ordering_key": 4,
      "author_kind": "agent",
      "kind": "reasoning",
      "operator_discord_user_id": null,
      "discord_message_ids": "[\"600000000000000004\"]"
    },
    {
      "id": "note_discord_1559189316138172416",
      "ordering_key": 5,
      "author_kind": "operator",
      "kind": "steer",
      "operator_discord_user_id": "444444444444444444",
      "discord_message_ids": "[\"600000000000000005\"]"
    },
    {
      "through_sequence": 5
    },
    {
      "sequence": 1,
      "message_id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "note_id": null,
      "author_kind": "customer"
    },
    {
      "sequence": 2,
      "message_id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "note_id": null,
      "author_kind": "agent"
    },
    {
      "sequence": 3,
      "message_id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "note_id": null,
      "author_kind": "agent"
    },
    {
      "sequence": 4,
      "message_id": null,
      "note_id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "author_kind": "agent"
    },
    {
      "sequence": 5,
      "message_id": null,
      "note_id": "note_discord_1559189316138172416",
      "author_kind": "operator"
    },
    {
      "sequence": 6,
      "message_id": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
      "note_id": null,
      "author_kind": "agent"
    },
    {
      "sequence": 7,
      "message_id": "msg_MzGoK2V5I08p-KgsiINLK6ZEPK3Ci5WTZSbkY_FJaK0",
      "note_id": null,
      "author_kind": "operator"
    }
  ]
}
```

Assertions passed: notes stored and posted; immutable note replay/conflict; shared message/note pagination; customer payload unchanged by notes; needsAgent and monotonic ack; signed allowlisted steering with identity and duplicate interaction; context Approve and Reject on non-button draft chunks; opposite decision preserves first result; existing human /reply wakes agent; customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft with Approve/Reject; signed allowlisted approval; customer-visible approved reply; duplicate approval without duplicate delivery; unanswered list empty; close persisted.
