# OF-19 follow-up: approved steering and joint translation approval

Run: 2026-10-15T15:39:05.191Z

Executed `node apps/api/scripts/verify-agent-api.mjs` against `wrangler dev --local`, using the real Hono Worker, D1 migrations 0000–0011, and MessageWorkflow. HTTP calls below were made with curl. Loopback Discord and Gemini REST fixtures captured requests. An ignored local Worker entrypoint redirects Gemini fetches to the fixture and rejects all other external fetches; the production workflow and translation adapter are unchanged by the harness. The fixture always returns needsReview=true; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.

## Curl transcript

### POST /v1/client/sessions

HTTP 201

```json
{
  "session": {
    "id": "session_e1397a7f8aa44c90b9abaa2943560c47",
    "token": "<redacted>",
    "visitorId": "visitor_JiLGcIaGuBfNTSUbqVyhVA5yxVcgbZuA9Yu1m9wO8cw",
    "expiresAt": "2026-11-14T15:38:50.000Z"
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:50.774Z"
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
      "createdAt": "2026-10-15T15:38:50.774Z",
      "updatedAt": "2026-10-15T15:38:51.876Z",
      "lastActivityAt": "2026-10-15T15:38:51.876Z",
      "claimedBy": null,
      "claimExpiresAt": null,
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-15T15:38:51.876Z",
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
        "createdAt": "2026-10-15T15:38:50.745Z",
        "updatedAt": "2026-10-15T15:38:50.745Z",
        "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:51.876Z",
    "lastActivityAt": "2026-10-15T15:38:51.876Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:51.876Z",
      "updatedAt": "2026-10-15T15:38:51.919Z",
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
  "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
  "claimExpiresAt": "2026-10-15T15:43:52.043Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
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
    "content": "Handed to the agent: it will translate this reply into the customer's language (inferred from the thread), send it, and post both versions here.",
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
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
    "content": "Handed to the agent: it will translate this reply into the customer's language (inferred from the thread), send it, and post both versions here.",
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
    "createdAt": "2026-10-15T15:38:53.492Z",
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
    "createdAt": "2026-10-15T15:38:53.492Z",
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
      "createdAt": "2026-10-15T15:38:50.774Z",
      "updatedAt": "2026-10-15T15:38:52.060Z",
      "lastActivityAt": "2026-10-15T15:38:52.060Z",
      "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
      "claimExpiresAt": "2026-10-15T15:43:52.043Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-15T15:38:51.876Z",
      "lastOperatorAt": "2026-10-15T15:38:52.358Z",
      "lastAgentAt": "2026-10-15T15:38:53.492Z",
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
        "createdAt": "2026-10-15T15:38:50.745Z",
        "updatedAt": "2026-10-15T15:38:50.745Z",
        "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:52.060Z",
    "lastActivityAt": "2026-10-15T15:38:52.060Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:51.876Z",
      "updatedAt": "2026-10-15T15:38:51.919Z",
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
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:52.060Z",
      "updatedAt": "2026-10-15T15:38:52.096Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_discord_1560316036354408448",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "3",
      "authorKind": "operator",
      "authorName": "444444444444444444",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000002): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab\",\"language\":\"customer\",\"sha256\":\"3badebf5b34a8c40b8be59fc1ae12d359e77ac4ad233e45819c5cfe0034f5bfd\",\"by\":\"444444444444444444\"}`\nYou can export as text or subtitles.",
      "createdAt": "2026-10-15T15:38:52.358Z",
      "discordMessageIds": [
        "600000000000000003"
      ]
    },
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
      "createdAt": "2026-10-15T15:38:53.492Z",
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:52.060Z",
    "lastActivityAt": "2026-10-15T15:38:52.060Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:51.876Z",
      "updatedAt": "2026-10-15T15:38:51.919Z",
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
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:52.060Z",
      "updatedAt": "2026-10-15T15:38:52.096Z",
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:52.060Z",
    "lastActivityAt": "2026-10-15T15:38:52.060Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
  },
  "verifiedUserId": null,
  "discordThreadUrl": "https://discord.com/channels/222222222222222222/555555555555555555",
  "messages": [],
  "notes": [
    {
      "id": "note_discord_1560316036354408448",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "3",
      "authorKind": "operator",
      "authorName": "444444444444444444",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000002): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab\",\"language\":\"customer\",\"sha256\":\"3badebf5b34a8c40b8be59fc1ae12d359e77ac4ad233e45819c5cfe0034f5bfd\",\"by\":\"444444444444444444\"}`\nYou can export as text or subtitles.",
      "createdAt": "2026-10-15T15:38:52.358Z",
      "discordMessageIds": [
        "600000000000000003"
      ]
    },
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
      "createdAt": "2026-10-15T15:38:53.492Z",
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "state": "available"
    }
  ],
  "nextCursor": "3",
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
      "createdAt": "2026-10-15T15:38:50.774Z",
      "updatedAt": "2026-10-15T15:38:52.060Z",
      "lastActivityAt": "2026-10-15T15:38:52.060Z",
      "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
      "claimExpiresAt": "2026-10-15T15:43:52.043Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-15T15:38:51.876Z",
      "lastOperatorAt": "2026-10-15T15:38:53.697Z",
      "lastAgentAt": "2026-10-15T15:38:53.492Z",
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
        "createdAt": "2026-10-15T15:38:50.745Z",
        "updatedAt": "2026-10-15T15:38:50.745Z",
        "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "createdAt": "2026-10-15T15:38:50.774Z",
      "updatedAt": "2026-10-15T15:38:52.060Z",
      "lastActivityAt": "2026-10-15T15:38:52.060Z",
      "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
      "claimExpiresAt": "2026-10-15T15:43:52.043Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-15T15:38:51.876Z",
      "lastOperatorAt": "2026-10-15T15:38:53.697Z",
      "lastAgentAt": "2026-10-15T15:38:53.492Z",
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
        "createdAt": "2026-10-15T15:38:50.745Z",
        "updatedAt": "2026-10-15T15:38:50.745Z",
        "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:52.060Z",
    "lastActivityAt": "2026-10-15T15:38:52.060Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:51.876Z",
      "updatedAt": "2026-10-15T15:38:51.919Z",
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
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:52.060Z",
      "updatedAt": "2026-10-15T15:38:52.096Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_discord_1560316036354408448",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "3",
      "authorKind": "operator",
      "authorName": "444444444444444444",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000002): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab\",\"language\":\"customer\",\"sha256\":\"3badebf5b34a8c40b8be59fc1ae12d359e77ac4ad233e45819c5cfe0034f5bfd\",\"by\":\"444444444444444444\"}`\nYou can export as text or subtitles.",
      "createdAt": "2026-10-15T15:38:52.358Z",
      "discordMessageIds": [
        "600000000000000003"
      ]
    },
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
      "createdAt": "2026-10-15T15:38:53.492Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    },
    {
      "id": "note_discord_1560316041999941632",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "5",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "PRIVATE: ask which export format the customer needs.",
      "createdAt": "2026-10-15T15:38:53.697Z",
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
    "content": "Handed to the agent: it will translate this reply into the customer's language (inferred from the thread), send it, and post both versions here.",
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
    "content": "Local operator already handed this draft to the agent (<t:1792078734:f>): it will translate this reply into the customer's language (inferred from the thread), send it, and post both versions here.",
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
    "content": "Queued for delivery as written. Reference: 1560316047385427968",
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
      "createdAt": "2026-10-15T15:38:50.774Z",
      "updatedAt": "2026-10-15T15:38:54.967Z",
      "lastActivityAt": "2026-10-15T15:38:54.967Z",
      "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
      "claimExpiresAt": "2026-10-15T15:43:52.043Z",
      "closedAt": null,
      "state": "open",
      "lastCustomerAt": "2026-10-15T15:38:51.876Z",
      "lastOperatorAt": "2026-10-15T15:38:54.967Z",
      "lastAgentAt": "2026-10-15T15:38:53.835Z",
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
        "createdAt": "2026-10-15T15:38:50.745Z",
        "updatedAt": "2026-10-15T15:38:50.745Z",
        "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "state": "available"
    },
    {
      "id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-15T15:38:54.967Z",
      "state": "available"
    }
  ],
  "nextCursor": "4",
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "state": "available"
    },
    {
      "id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-15T15:38:54.967Z",
      "state": "available"
    }
  ],
  "nextCursor": "4",
  "hasMore": false
}
```

### POST /v1/discord/interactions (Approve draft)

HTTP 200

```json
{
  "type": 4,
  "data": {
    "content": "Handed to the agent: it will translate this reply into French (fr), send it, and post both versions here.",
    "flags": 64,
    "allowed_mentions": {
      "parse": []
    }
  }
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
    "customerLanguage": "fr",
    "customerLanguageUpdatedAt": null,
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:38:54.967Z",
    "lastActivityAt": "2026-10-15T15:38:54.967Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
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
    "createdAt": "2026-10-15T15:38:50.745Z",
    "updatedAt": "2026-10-15T15:38:50.745Z",
    "lastSeenAt": "2026-10-15T15:38:50.745Z"
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "projected",
      "discordAuditStatus": "not_applicable",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:51.876Z",
      "updatedAt": "2026-10-15T15:38:51.919Z",
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
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:52.060Z",
      "updatedAt": "2026-10-15T15:38:52.096Z",
      "sequence": "2",
      "translations": [],
      "onDemandTranslations": []
    },
    {
      "rowId": 3,
      "id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": null,
      "workflowInstanceId": "operator_MmPkjfsRirenBVp2TmqyaGtpSqg_44PehttSfz48fpA",
      "direction": "operator_to_customer",
      "attachments": [],
      "authorKind": "operator",
      "authorName": null,
      "originalText": "Human follow-up through the existing reply command.",
      "originalLanguage": null,
      "replyTranslation": "off",
      "replyTranslationRequest": "off",
      "customerVisibleText": "Human follow-up through the existing reply command.",
      "customerVisibleLanguage": null,
      "operatorVisibleText": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-15T15:38:54.967Z",
      "processingGeneration": 1,
      "processingStatus": "succeeded",
      "customerAvailability": "available",
      "operatorProjectionStatus": "not_applicable",
      "discordAuditStatus": "projected",
      "failureStage": null,
      "failureCode": null,
      "createdAt": "2026-10-15T15:38:54.967Z",
      "updatedAt": "2026-10-15T15:38:55.015Z",
      "sequence": "7",
      "translations": [],
      "onDemandTranslations": []
    }
  ],
  "notes": [
    {
      "id": "note_discord_1560316036354408448",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "3",
      "authorKind": "operator",
      "authorName": "444444444444444444",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000002): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab\",\"language\":\"customer\",\"sha256\":\"3badebf5b34a8c40b8be59fc1ae12d359e77ac4ad233e45819c5cfe0034f5bfd\",\"by\":\"444444444444444444\"}`\nYou can export as text or subtitles.",
      "createdAt": "2026-10-15T15:38:52.358Z",
      "discordMessageIds": [
        "600000000000000003"
      ]
    },
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
      "createdAt": "2026-10-15T15:38:53.492Z",
      "discordMessageIds": [
        "600000000000000004"
      ]
    },
    {
      "id": "note_discord_1560316041999941632",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "5",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "PRIVATE: ask which export format the customer needs.",
      "createdAt": "2026-10-15T15:38:53.697Z",
      "discordMessageIds": [
        "600000000000000005"
      ]
    },
    {
      "id": "note_discord_1560316047091826688",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "6",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000006): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6\",\"language\":\"customer\",\"sha256\":\"b3bc9e928ae87fbaeef4479bcbdbbded61c80fabb55d4cf6a9078ff846757c1f\",\"by\":\"444444444444444444\"}`\nEnglish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
      "createdAt": "2026-10-15T15:38:54.913Z",
      "discordMessageIds": [
        "600000000000000008",
        "600000000000000009"
      ]
    },
    {
      "id": "note_discord_1560316061646061568",
      "workspaceId": "workspace_of10",
      "inboxId": "inbox_of10",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "sequence": "8",
      "authorKind": "operator",
      "authorName": "Local operator",
      "operatorDiscordUserId": "444444444444444444",
      "kind": "steer",
      "text": "Approved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000011): translate it into French (fr) and send it.\n`approve:{\"draft\":\"msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4\",\"language\":\"fr\",\"sha256\":\"b4954c433fe4e77e5121f0d22b2611328fbbef97a03c1d002939e746c4a05b8e\",\"by\":\"444444444444444444\"}`\nThe English export answer for joint approval.",
      "createdAt": "2026-10-15T15:38:58.383Z",
      "discordMessageIds": [
        "600000000000000012"
      ]
    }
  ],
  "through": "8",
  "nextCursor": null,
  "activity": null
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
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "processing"
    },
    {
      "id": "msg_eJ6gHO6C66fZ7Rji-z9kDXn8v60R38Hk3jTM2nDTF5o",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "clientMessageId": "of10-question",
      "direction": "customer_to_operator",
      "text": "How can I export my transcript?",
      "language": "en",
      "acceptedAt": "2026-10-15T15:38:51.876Z",
      "state": "available"
    },
    {
      "id": "msg_agent_cb09d5490e19b0fc770cf249fb769148933083a01522128778a2614364206761",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Open the transcript and choose Export.",
      "acceptedAt": "2026-10-15T15:38:52.060Z",
      "state": "available"
    },
    {
      "id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "threadId": "thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk",
      "direction": "operator_to_customer",
      "text": "Human follow-up through the existing reply command.",
      "acceptedAt": "2026-10-15T15:38:54.967Z",
      "state": "available"
    }
  ],
  "nextCursor": "4",
  "hasMore": false
}
```

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/ack

HTTP 200

```json
{
  "acknowledgedCursor": "8"
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

### POST /threads/thread_Lg5j_rB-F4ch5ESjK8cZPBdaeQm51zLS7BRtz8168Jk/replies/msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e/approve

HTTP 200

```json
{
  "messageId": "msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e",
  "outcome": "approved"
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
    "createdAt": "2026-10-15T15:38:50.774Z",
    "updatedAt": "2026-10-15T15:39:04.097Z",
    "lastActivityAt": "2026-10-15T15:38:59.538Z",
    "claimedBy": "agent_bbc84623841d143f1a792e7325cfc344",
    "claimExpiresAt": "2026-10-15T15:43:52.043Z",
    "closedAt": "2026-10-15T15:39:04.097Z"
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
    "content": "**Agent Local helper · Draft, not sent**\nYou can export as text or subtitles.\n\n_To send it: right-click this message (long-press on a phone) → Apps → **Approve draft**, or `/approve` with this message's link and a language. The agent then sends the English above in the customer's language (or the one you name) and posts both versions here. To change it, use /agent or /reply._",
    "nonce": "ac-0-2243bb1ec9f2a9be",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000002",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator 444444444444444444** · steer\nApproved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000002): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_c63c2bba3b50b8b363b5ba23e941cbc2fd2aec87cf3ad551857f572693a2d2ab\",\"language\":\"customer\",\"sha256\":\"3badebf5b34a8c40b8be59fc1ae12d359e77ac4ad233e45819c5cfe0034f5bfd\",\"by\":\"444444444444444444\"}`\nYou can export as text or subtitles.",
    "nonce": "ac-0-42906274f2b8b510",
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
    "nonce": "ac-0-84e395a9682d2560",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000005",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft, not sent**\nEnglish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. Engl",
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
    "content": "ish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. \n\n_To send it: right-click this message (long-press on a phone) → Apps → **Approve draft**, or `/approve` with this message's link and a language. The agent then sends the English above in the customer's language (or the one you name) and posts both versions here. To change it, use /agent or /reply._",
    "nonce": "ac-1-d7b3937896b2f5b0",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000007",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator Local operator** · steer\nApproved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000006): translate it into the customer's language (inferred from the thread) and send it.\n`approve:{\"draft\":\"msg_agent_da8f720fd0d832a9761283a91c23e39aadce1cb46a0b2b37abc2f817142014a6\",\"language\":\"customer\",\"sha256\":\"b3bc9e928ae87fbaeef4479bcbdbbded61c80fabb55d4cf6a9078ff846757c1f\",\"by\":\"444444444444444444\"}`\nEnglish Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Ap",
    "nonce": "ac-0-97c1d423b8534228",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000008",
    "channel_id": "555555555555555555"
  },
  {
    "content": "prove draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. English Approve draft. ",
    "nonce": "ac-1-97c1d423b8534228",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000009",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Available in chat · sent as written**\nHuman follow-up through the existing reply command.",
    "nonce": "ac-0-f5e67b8d2d2597a1",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000010",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft, not sent**\nThe English export answer for joint approval.\n\n**Translation preview (fr)**\nVoici la réponse française approuvée.\n\n**Review translation wording**\nVerify the export wording.\n\n_To send it: right-click this message (long-press on a phone) → Apps → **Approve draft**, or `/approve` with this message's link and a language. The agent then sends the English above in the customer's language (or the one you name) and posts both versions here. To change it, use /agent or /reply._",
    "nonce": "ac-0-a029142e8e566e9c",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000011",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator Local operator** · steer\nApproved [this draft](https://discord.com/channels/222222222222222222/555555555555555555/600000000000000011): translate it into French (fr) and send it.\n`approve:{\"draft\":\"msg_agent_891009f1b216ddb12502908ac255d8f7fd0ace0d20d177d0fa98664236010ba4\",\"language\":\"fr\",\"sha256\":\"b4954c433fe4e77e5121f0d22b2611328fbbef97a03c1d002939e746c4a05b8e\",\"by\":\"444444444444444444\"}`\nThe English export answer for joint approval.",
    "nonce": "ac-0-a4bb6aa1a64c8f7e",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000012",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Agent Local helper · Draft, not sent**\nLegacy English answer.\n\n_To send it: right-click this message (long-press on a phone) → Apps → **Approve draft**, or `/approve` with this message's link and a language. The agent then sends the English above in the customer's language (or the one you name) and posts both versions here. To change it, use /agent or /reply._",
    "nonce": "ac-0-d99fc0afab7b73d1",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000013",
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
    "id": "600000000000000014",
    "channel_id": "555555555555555555"
  },
  {
    "content": "**Operator Local operator** · steer\nPRIVATE: investigate the next issue, keeping the approved answer.",
    "nonce": "ac-0-7244374a482f199d",
    "enforce_nonce": true,
    "allowed_mentions": {
      "parse": [],
      "replied_user": false
    },
    "id": "600000000000000015",
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
    "id": "600000000000000016",
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
      "claimed_by": "agent_bbc84623841d143f1a792e7325cfc344"
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
      "id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "author_kind": "operator",
      "author_name": null,
      "customer_visible_text": "Human follow-up through the existing reply command.",
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
      "status": "stale",
      "decided_by": null
    }
  ],
  "threadFlow": [
    {
      "id": "note_discord_1560316036354408448",
      "ordering_key": 3,
      "author_kind": "operator",
      "kind": "steer",
      "operator_discord_user_id": "444444444444444444",
      "discord_message_ids": "[\"600000000000000003\"]"
    },
    {
      "id": "note_agent_731a8f33f0b2899b629bc1ad4b6e45aec3c52274b5ef82267d2f166f109b2c6d",
      "ordering_key": 4,
      "author_kind": "agent",
      "kind": "reasoning",
      "operator_discord_user_id": null,
      "discord_message_ids": "[\"600000000000000004\"]"
    },
    {
      "id": "note_discord_1560316041999941632",
      "ordering_key": 5,
      "author_kind": "operator",
      "kind": "steer",
      "operator_discord_user_id": "444444444444444444",
      "discord_message_ids": "[\"600000000000000005\"]"
    },
    {
      "id": "note_discord_1560316047091826688",
      "ordering_key": 6,
      "author_kind": "operator",
      "kind": "steer",
      "operator_discord_user_id": "444444444444444444",
      "discord_message_ids": "[\"600000000000000008\",\"600000000000000009\"]"
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
      "message_id": null,
      "note_id": "note_discord_1560316036354408448",
      "author_kind": "operator"
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
      "note_id": "note_discord_1560316041999941632",
      "author_kind": "operator"
    },
    {
      "sequence": 6,
      "message_id": null,
      "note_id": "note_discord_1560316047091826688",
      "author_kind": "operator"
    },
    {
      "sequence": 7,
      "message_id": "msg_IR2tzeaIPjWs2a-xSnO6YOlJzqpVYHnXPbGA3RnmWb4",
      "note_id": null,
      "author_kind": "operator"
    }
  ],
  "approvedTranslations": [
    {
      "message_id": "msg_agent_6d5eb7400aaf08620d5b76b1c0bb7bc3b4ba85384c874914d05ba589f412327e",
      "status": "approved",
      "decided_by": "agent:Local helper",
      "confirmed_by": "444444444444444444",
      "customer_visible_text": "Voici la réponse française approuvée."
    }
  ],
  "translationProviderCalls": 2
}
```

Assertions passed: English and uncertain translation preview displayed before approval; Approve draft, /approve and old Approve buttons hand the draft back to the agent as an operator note with the approve line (draft, language, English hash, operator) and the English text, stale the draft and publish nothing; repeated approval answers that the draft was already handed back; one provider call for the preview; legacy agent-approved translation survives steering and completes after its existing translation approval; notes stored and posted; immutable note replay/conflict; shared message/note pagination; customer payload unchanged by notes; needsAgent and monotonic ack; signed allowlisted steering with identity and duplicate interaction; context Approve on non-button draft chunks; existing human /reply wakes agent; customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft; signed allowlisted hand-back; nothing customer-visible from an approval; duplicate approval without a second note; unanswered list empty; close persisted.
