import Foundation

public struct CustomerContext: Codable, Sendable, Equatable {
  public var userId: String?
  public var email: String?
  public var posthogDistinctId: String?
  public var posthogSessionId: String?
  public var locale: String?
  public var timezone: String?
  public var metadata: [String: JSONValue]?

  public init(
    userId: String? = nil, email: String? = nil, locale: String? = nil,
    timezone: String? = nil, posthogDistinctId: String? = nil,
    posthogSessionId: String? = nil, metadata: [String: JSONValue]? = nil
  ) {
    self.userId = userId
    self.email = email
    self.locale = locale
    self.timezone = timezone
    self.posthogDistinctId = posthogDistinctId
    self.posthogSessionId = posthogSessionId
    self.metadata = metadata
  }
}

public enum JSONValue: Codable, Sendable, Equatable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null
  public init(from decoder: any Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() {
      self = .null
    } else if let v = try? value.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? value.decode(String.self) {
      self = .string(v)
    } else if let v = try? value.decode(Double.self) {
      self = .number(v)
    } else if let v = try? value.decode([String: JSONValue].self) {
      self = .object(v)
    } else {
      self = .array(try value.decode([JSONValue].self))
    }
  }
  public func encode(to encoder: any Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .string(let v): try value.encode(v)
    case .number(let v): try value.encode(v)
    case .bool(let v): try value.encode(v)
    case .object(let v): try value.encode(v)
    case .array(let v): try value.encode(v)
    case .null: try value.encodeNil()
    }
  }
}

public struct SupportThread: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let clientThreadId: String
  public let state: String
  public let createdAt: String
  public let updatedAt: String
}
public struct SupportMessage: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let threadId: String
  public let clientMessageId: String?
  public let direction: String
  public let text: String
  public let language: String?
  public let acceptedAt: String
  public let state: String
  public var isReply: Bool { direction == "operator_to_customer" && state == "available" }
}
public struct ClientSession: Codable, Sendable {
  public let id: String
  public let token: String
  public let visitorId: String
  public let expiresAt: String
}
public struct SessionResponse: Codable, Sendable { public let session: ClientSession }
public struct ThreadResponse: Codable, Sendable { public let thread: SupportThread }
public struct ThreadStatus: Codable, Sendable, Equatable {
  public let thread: SupportThread
  public let latestReplyCursor: String
}
public struct StatusPage: Codable, Sendable {
  public let threads: [ThreadStatus]
  public let nextCursor: String?
}
public struct MessagePage: Codable, Sendable {
  public let threadId: String
  public let messages: [SupportMessage]
  public let nextCursor: String
  public let hasMore: Bool
}
public struct Acceptance: Codable, Sendable {
  public let messageId: String
  public let clientMessageId: String
  public let status: String
  public let message: SupportMessage?
  public let failureCode: String?
}
public struct SendResponse: Codable, Sendable { public let acceptance: Acceptance }

public struct PendingMessage: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let text: String
  public let acceptedAt: String
  public var delivery: String
}

public struct RespondKitError: Error, LocalizedError, Sendable {
  public let code: String
  public let message: String
  public let retryable: Bool
  public let status: Int?
  public var errorDescription: String? { message }
  public init(
    _ message: String, code: String = "invalid_response", retryable: Bool = false,
    status: Int? = nil
  ) {
    self.message = message
    self.code = code
    self.retryable = retryable
    self.status = status
  }
}

/// The v1 cursor is an unsigned decimal string bounded by JavaScript's safe integer range.
public func replyCursor(_ value: String) throws -> Int64 {
  guard !value.isEmpty, value == "0" || value.first != "0",
    value.utf8.allSatisfy({ (48...57).contains($0) }),
    let result = Int64(value), result <= 9_007_199_254_740_991
  else {
    throw RespondKitError("Invalid reply cursor.")
  }
  return result
}

func timestamp(_ value: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
func newID(_ prefix: String) -> String {
  prefix + "_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
}
