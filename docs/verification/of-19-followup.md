# OF-19 follow-up: approved steering and joint translation approval

Run: 2026-10-12T15:23:38.460Z

Executed `node apps/api/scripts/verify-agent-api.mjs` against `wrangler dev --local`, using the real Hono Worker, D1 migrations 0000–0011, and MessageWorkflow. HTTP calls below were made with curl. Loopback Discord and Gemini REST fixtures captured requests. An ignored local Worker entrypoint redirects Gemini fetches to the fixture and rejects all other external fetches; the production workflow and translation adapter are unchanged by the harness. The fixture always returns needsReview=true; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.

## Follow-up verification

Run on 2026-10-12 from `developer/of-19-followup`, based on fetched `origin/main` 105ed9e. The approved-steering regression was committed before the fix and failed as expected: `stale` instead of `approved` (`2ec67a7`).

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm check` | Formatting, lint and types passed, zero warnings |
| `pnpm test:all` | 387 tests in 43 files passed, including 150 API tests |
| `pnpm --filter @respondkit/web build` | Passed; existing bundle-size advisory only |
| `node apps/api/scripts/verify-agent-api.mjs` | Passed: 52 recorded HTTP calls, 19 Discord posts, 2 Gemini fixture calls |

Commands used `VOLTA_FEATURE_PNPM=1` with Volta on PATH. Unit tests cover the populated 0010→0011 upgrade without changing existing rows, pending-only steering invalidation, legacy approved translation review after steering, normal and uncertain translation previews, no customer message before approval, exact result reuse, recorded operator confirmation, premature approval refusal, rejection, duplicate/opposite decisions, stale pending previews, and refusal to auto-confirm from approved draft status alone. Earlier message/SDK/email/Discord tests remain in the full suite. Migrations 0000–0010 are unchanged.

The walkthrough exercises the real Hono, D1, MessageWorkflow and Gemini translation adapter against loopback REST fixtures. The first translated draft displays English, French and the uncertainty warning, then one signed context approval publishes the exact saved French result. D1 readback records the same operator and byte-identical result JSON in `reply_review`; duplicate approval and request replay leave the provider call count at one. A seeded legacy envelope uses the original two-step path, is approved, receives an operator steer while awaiting translation review, remains approved, and successfully publishes after its existing translation button is used.

## Design and rollout

`agent_draft_preview` keeps translations outside the customer message table until approval. All preview chunks must be posted before **Approve** can atomically record the first draft decision and preview confirmation. After authorized ingress, the workflow carries that confirmation into `reply_review` and publishes the original durable translation step result. Approved status without the recorded preview confirmation cannot release a translation. This is an explicit signed approval of the displayed result, not an automatic translation confirmation.

The immutable envelope marks new translated drafts for this flow. Existing accepted drafts retain their original flow and review button, avoiding retroactive changes to an in-flight review. Migration 0011 fixes the operator-note trigger for both paths; customer messages, human replies and thread closure retain their existing invalidation behavior. The API docs also tell runners to baseline-ack the pre-0010 backlog at go-live and page to the end.

No production tokens were loaded. No production API writes, real provider calls, remote migrations, deployments, command registrations or merge were performed. Real Discord client interaction and translation quality were not tested. The front desk owns migration/deployment after merge; independent review is requested at the final PR head.

## Curl transcript

### POST /v1/client/sessions

HTTP 201

```json
{
  "session": {
    "id": "session_e50f1740acd64a03a16b2a259a9078f7",
    "token": "<redacted>",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "expiresAt": "2026-11-11T15:23:24.000Z"
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:24.417Z"
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
      "createdAt": "2026-10-12T15:23:24.417Z",
      "updatedAt": "2026-10-12T15:23:25.384Z",
      "lastActivityAt": "2026-10-12T15:23:25.384Z",
      "claimedBy": null,
      "claimExpiresAt": null,
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T15:23:25.384Z",
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
        "createdAt": "2026-10-12T15:23:24.400Z",
        "updatedAt": "2026-10-12T15:23:24.400Z",
        "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:25.384Z",
    "lastActivityAt": "2026-10-12T15:23:25.384Z",
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
    "createdAt": "2026-10-12T15:23:24.400Z",
    "updatedAt": "2026-10-12T15:23:24.400Z",
    "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.384Z",
      "updatedAt": "2026-10-12T15:23:25.411Z",
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
  "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
  "claimExpiresAt": "2026-10-12T15:28:25.538Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T15:23:25.550Z",
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T15:23:25.684Z",
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
    "createdAt": "2026-10-12T15:23:25.987Z",
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
    "createdAt": "2026-10-12T15:23:25.987Z",
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
      "createdAt": "2026-10-12T15:23:24.417Z",
      "updatedAt": "2026-10-12T15:23:25.684Z",
      "lastActivityAt": "2026-10-12T15:23:25.684Z",
      "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
      "claimExpiresAt": "2026-10-12T15:28:25.538Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T15:23:25.384Z",
      "lastOperatorAt": null,
      "lastAgentAt": "2026-10-12T15:23:25.987Z",
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
        "createdAt": "2026-10-12T15:23:24.400Z",
        "updatedAt": "2026-10-12T15:23:24.400Z",
        "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:25.684Z",
    "lastActivityAt": "2026-10-12T15:23:25.684Z",
    "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
    "claimExpiresAt": "2026-10-12T15:28:25.538Z",
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
    "createdAt": "2026-10-12T15:23:24.400Z",
    "updatedAt": "2026-10-12T15:23:24.400Z",
    "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.384Z",
      "updatedAt": "2026-10-12T15:23:25.411Z",
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
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.550Z",
      "updatedAt": "2026-10-12T15:23:25.574Z",
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
      "acceptedAt": "2026-10-12T15:23:25.684Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.684Z",
      "updatedAt": "2026-10-12T15:23:25.849Z",
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
      "createdAt": "2026-10-12T15:23:25.987Z",
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:25.684Z",
    "lastActivityAt": "2026-10-12T15:23:25.684Z",
    "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
    "claimExpiresAt": "2026-10-12T15:28:25.538Z",
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
    "createdAt": "2026-10-12T15:23:24.400Z",
    "updatedAt": "2026-10-12T15:23:24.400Z",
    "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.384Z",
      "updatedAt": "2026-10-12T15:23:25.411Z",
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
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.550Z",
      "updatedAt": "2026-10-12T15:23:25.574Z",
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:25.684Z",
    "lastActivityAt": "2026-10-12T15:23:25.684Z",
    "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
    "claimExpiresAt": "2026-10-12T15:28:25.538Z",
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
    "createdAt": "2026-10-12T15:23:24.400Z",
    "updatedAt": "2026-10-12T15:23:24.400Z",
    "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.684Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.684Z",
      "updatedAt": "2026-10-12T15:23:25.849Z",
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
      "createdAt": "2026-10-12T15:23:25.987Z",
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T15:23:25.684Z",
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
      "createdAt": "2026-10-12T15:23:24.417Z",
      "updatedAt": "2026-10-12T15:23:25.684Z",
      "lastActivityAt": "2026-10-12T15:23:25.684Z",
      "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
      "claimExpiresAt": "2026-10-12T15:28:25.538Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T15:23:25.384Z",
      "lastOperatorAt": "2026-10-12T15:23:26.122Z",
      "lastAgentAt": "2026-10-12T15:23:25.987Z",
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
        "createdAt": "2026-10-12T15:23:24.400Z",
        "updatedAt": "2026-10-12T15:23:24.400Z",
        "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "createdAt": "2026-10-12T15:23:24.417Z",
      "updatedAt": "2026-10-12T15:23:25.684Z",
      "lastActivityAt": "2026-10-12T15:23:25.684Z",
      "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
      "claimExpiresAt": "2026-10-12T15:28:25.538Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T15:23:25.384Z",
      "lastOperatorAt": "2026-10-12T15:23:26.122Z",
      "lastAgentAt": "2026-10-12T15:23:25.987Z",
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
        "createdAt": "2026-10-12T15:23:24.400Z",
        "updatedAt": "2026-10-12T15:23:24.400Z",
        "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:25.684Z",
    "lastActivityAt": "2026-10-12T15:23:25.684Z",
    "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
    "claimExpiresAt": "2026-10-12T15:28:25.538Z",
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
    "createdAt": "2026-10-12T15:23:24.400Z",
    "updatedAt": "2026-10-12T15:23:24.400Z",
    "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.384Z",
      "updatedAt": "2026-10-12T15:23:25.411Z",
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
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.550Z",
      "updatedAt": "2026-10-12T15:23:25.574Z",
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
      "acceptedAt": "2026-10-12T15:23:25.684Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-12T15:23:25.684Z",
      "updatedAt": "2026-10-12T15:23:25.849Z",
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
      "createdAt": "2026-10-12T15:23:25.987Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    },
    {
      "id": "note_discord_1559224987892580352",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "5",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "PRIVATE: ask which export format the customer needs.",
      "createdAt": "2026-10-12T15:23:26.122Z",
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
    "content": "Queued for delivery as written. Reference: 1559224996843225088",
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
      "createdAt": "2026-10-12T15:23:24.417Z",
      "updatedAt": "2026-10-12T15:23:28.247Z",
      "lastActivityAt": "2026-10-12T15:23:28.247Z",
      "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
      "claimExpiresAt": "2026-10-12T15:28:25.538Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-12T15:23:25.384Z",
      "lastOperatorAt": "2026-10-12T15:23:28.247Z",
      "lastAgentAt": "2026-10-12T15:23:27.257Z",
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
        "createdAt": "2026-10-12T15:23:24.400Z",
        "updatedAt": "2026-10-12T15:23:24.400Z",
        "lastSeenAt": "2026-10-12T15:23:24.400Z"
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T15:23:25.684Z",
      "state": "available"
    },
    {
      "id": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
      "acceptedAt": "2026-10-12T15:23:26.228Z",
      "state": "available"
    },
    {
      "id": "msg_5vOJAInH6iUMFcE3OHRjFw1SE4rfVFkbhBUYSR7jcI8",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-12T15:23:28.247Z",
      "state": "available"
    }
  ],
  "nextCursor": "6",
  "hasMore": false
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4",
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
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-12T15:23:25.384Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-12T15:23:25.550Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-12T15:23:25.684Z",
      "state": "available"
    },
    {
      "id": "msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
      "acceptedAt": "2026-10-12T15:23:26.228Z",
      "state": "available"
    },
    {
      "id": "msg_5vOJAInH6iUMFcE3OHRjFw1SE4rfVFkbhBUYSR7jcI8",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-12T15:23:28.247Z",
      "state": "available"
    }
  ],
  "nextCursor": "6",
  "hasMore": false
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

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies

HTTP 202

```json
{
  "messageId": "msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4",
  "mode": "draft",
  "status": "available",
  "acceptance": "created",
  "workflowStatus": null,
  "processingStatus": "succeeded",
  "failureCode": null
}
```

### POST /v1/discord/interactions (Approve draft)

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
  "messageId": "msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e",
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

### POST /v1/discord/interactions (legacy Approve translation after steering)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Agent translation approved for delivery.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
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
    "customerLanguage": "fr",
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-12T15:23:24.417Z",
    "updatedAt": "2026-10-12T15:23:37.456Z",
    "lastActivityAt": "2026-10-12T15:23:33.167Z",
    "claimedBy": "agent_9836b2944486061d17bdc6d742e1bcab",
    "claimExpiresAt": "2026-10-12T15:28:25.538Z",
    "closedAt": "2026-10-12T15:23:37.456Z"
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
    "nonce": "ac-0-555b17982e923cd7",
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
    "nonce": "ac-0-77eaaca0109abbd6",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000012",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft**\nThe English export answer for joint approval.\n\n**Translation (fr)**\nVoici la réponse française approuvée.\n\n**Review translation wording**\nVerify the export wording.\n\nApprove confirms the English reply and this translation.",
    "nonce": "ac-0-a029142e8e566e9c",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve",
            "custom_id": "agent:approve:msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4"
          },
          {
            "type": 2,
            "style": 4,
            "label": "Reject",
            "custom_id": "agent:reject:msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000013",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper**\n**Reply sent · English → French**\n⚠️ **Translation needs review.** Check the customer-facing text.\nThe English export answer for joint approval.\n\n-# Customer received in French\n-# Voici la réponse française approuvée.",
    "nonce": "ac-0-e62c608a63dda5e2",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000014",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft**\nLegacy English answer.\n\nTranslate to fr",
    "nonce": "ac-0-d99fc0afab7b73d1",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve",
            "custom_id": "agent:approve:msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e"
          },
          {
            "type": 2,
            "style": 4,
            "label": "Reject",
            "custom_id": "agent:reject:msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000015",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Review translation**\nOriginal: Legacy English answer.\n\nfr: Voici la réponse française approuvée.",
    "nonce": "ac-0-61ecab6b3fbc2cb7",
    "enforce_nonce": true,
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 3,
            "label": "Approve translation",
            "custom_id": "agent:translate:msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e:1"
          }
        ]
      }
    ],
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000016",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator Local operator** · steer\nPRIVATE: investigate the next issue, keeping the approved answer.",
    "nonce": "ac-0-fa8d81935dfffaca",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000017",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper**\n**Reply sent · English → French**\n⚠️ **Translation needs review.** Check the customer-facing text.\nLegacy English answer.\n\n-# Customer received in French\n-# Voici la réponse française approuvée.",
    "nonce": "ac-0-ff50e59cf8443a6f",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000018",
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
      "claimed_by": "agent_9836b2944486061d17bdc6d742e1bcab"
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
      "id": "msg_5vOJAInH6iUMFcE3OHRjFw1SE4rfVFkbhBUYSR7jcI8",
      "author_kind": "operator",
      "author_name": null,
      "customer_visible_text": "Human follow-up through the existing reply command.",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4",
      "author_kind": "agent",
      "author_name": "Local helper",
      "customer_visible_text": "Voici la réponse française approuvée.",
      "processing_status": "succeeded"
    },
    {
      "id": "msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e",
      "author_kind": "agent",
      "author_name": "Local helper",
      "customer_visible_text": "Voici la réponse française approuvée.",
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
      "id": "note_discord_1559224987892580352",
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
      "note_id": "note_discord_1559224987892580352",
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
      "message_id": "msg_5vOJAInH6iUMFcE3OHRjFw1SE4rfVFkbhBUYSR7jcI8",
      "note_id": null,
      "author_kind": "operator"
    }
  ],
  "approvedTranslations": [
    {
      "message_id": "msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e",
      "status": "approved",
      "decided_by": "444444444444444444",
      "confirmed_by": "444444444444444444",
      "customer_visible_text": "Voici la réponse française approuvée."
    },
    {
      "message_id": "msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4",
      "status": "approved",
      "decided_by": "444444444444444444",
      "confirmed_by": "444444444444444444",
      "customer_visible_text": "Voici la réponse française approuvée."
    }
  ],
  "translationProviderCalls": 2
}
```

Assertions passed: English and uncertain translation displayed before one signed approval; exact result reused with one provider call; real operator recorded in reply_review; duplicate approval/replay does not retranslate; legacy approved translation survives steering and completes after its existing translation approval; notes stored and posted; immutable note replay/conflict; shared message/note pagination; customer payload unchanged by notes; needsAgent and monotonic ack; signed allowlisted steering with identity and duplicate interaction; context Approve and Reject on non-button draft chunks; opposite decision preserves first result; existing human /reply wakes agent; customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft with Approve/Reject; signed allowlisted approval; customer-visible approved reply; duplicate approval without duplicate delivery; unanswered list empty; close persisted.
