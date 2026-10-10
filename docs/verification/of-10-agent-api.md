# OF-10 operator API verification

Run: 2026-10-10T13:36:27.719Z

Executed `node apps/api/scripts/verify-agent-api.mjs` against `wrangler dev --local`, using the real Hono Worker, D1 migrations 0000–0009, and MessageWorkflow. HTTP calls below were made with curl. A loopback Discord REST fixture captured posts; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.

## Curl transcript

### POST /v1/client/sessions

HTTP 201

```json
{
  "session": {
    "id": "session_c81afabc57f843349ff89fabf5484ac1",
    "token": "<redacted>",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "expiresAt": "2026-11-09T13:36:25.000Z"
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
    "createdAt": "2026-10-10T13:36:25.173Z",
    "updatedAt": "2026-10-10T13:36:25.173Z"
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
      "createdAt": "2026-10-10T13:36:25.173Z",
      "updatedAt": "2026-10-10T13:36:26.140Z",
      "lastActivityAt": "2026-10-10T13:36:26.140Z",
      "claimedBy": null,
      "claimExpiresAt": null,
      "closedAt": null,
      "state": "open",
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
        "createdAt": "2026-10-10T13:36:25.156Z",
        "updatedAt": "2026-10-10T13:36:25.156Z",
        "lastSeenAt": "2026-10-10T13:36:25.156Z"
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
    "createdAt": "2026-10-10T13:36:25.173Z",
    "updatedAt": "2026-10-10T13:36:26.140Z",
    "lastActivityAt": "2026-10-10T13:36:26.140Z",
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
    "createdAt": "2026-10-10T13:36:25.156Z",
    "updatedAt": "2026-10-10T13:36:25.156Z",
    "lastSeenAt": "2026-10-10T13:36:25.156Z"
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
      "acceptedAt": "2026-10-10T13:36:26.140Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-10T13:36:26.140Z",
      "updatedAt": "2026-10-10T13:36:26.168Z",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "nextCursor": null,
  "activity": null
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/claim

HTTP 200

```json
{
  "claimedBy": "agent_0e190a016403e7b9c8c8901b58d2802e",
  "claimExpiresAt": "2026-10-10T13:41:26.293Z"
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
      "acceptedAt": "2026-10-10T13:36:26.140Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-10T13:36:26.140Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-10T13:36:26.306Z",
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
      "acceptedAt": "2026-10-10T13:36:26.140Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-10T13:36:26.140Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-10T13:36:26.306Z",
      "state": "available"
    },
    {
      "id": "msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "You can export as text or subtitles.",
      "acceptedAt": "2026-10-10T13:36:26.446Z",
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
    "content": "Draft approved for delivery. Repeated approval will not send another reply.",
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
    "createdAt": "2026-10-10T13:36:25.173Z",
    "updatedAt": "2026-10-10T13:36:26.761Z",
    "lastActivityAt": "2026-10-10T13:36:26.446Z",
    "claimedBy": "agent_0e190a016403e7b9c8c8901b58d2802e",
    "claimExpiresAt": "2026-10-10T13:41:26.293Z",
    "closedAt": "2026-10-10T13:36:26.761Z"
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
  }
]
```

## D1 readback

```json
[
  {
    "status": "closed",
    "claimed_by": "agent_0e190a016403e7b9c8c8901b58d2802e"
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
    "status": "approved",
    "decided_by": "444444444444444444"
  }
]
```

Assertions passed: customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft with Approve/Reject; signed allowlisted approval; customer-visible approved reply; duplicate approval without duplicate delivery; unanswered list empty; close persisted.

## Automated checks

- Workspace `pnpm check`: passed, no formatting/lint/type errors or warnings.
- Workspace `pnpm test:all`: 361 tests passed. API: 124; Discord: 51; conversations: 9. Agent routes contribute 16 tests, with a separate 0008→0009 migration test.
- `pnpm --dir apps/web build`: docs export and both client/server builds passed.
- [Agent route tests](../../apps/api/src/agent-api.test.ts) cover authentication, isolation, rate limiting, needsReply/pagination, claims, idempotency, signed draft decisions, translation review, stale-publication guards, PostHog reads, and ambiguous acceptance.
- [Migration test](../../apps/api/src/agent-migration.test.ts) applies 0009 to real 0008 customer/operator/email data.

The independent verifier verdict at the final PR head remains pending. These are developer-run checks. No deployed Worker or live customer channel was modified.
