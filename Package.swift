// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "RespondKit",
  platforms: [.iOS(.v18), .macOS(.v15)],
  products: [
    .library(name: "RespondKitCore", targets: ["RespondKitCore"]),
    .library(name: "RespondKitUI", targets: ["RespondKitUI"]),
  ],
  targets: [
    .target(name: "RespondKitCore", path: "native/swift/Sources/RespondKitCore"),
    .target(
      name: "RespondKitUI", dependencies: ["RespondKitCore"],
      path: "native/swift/Sources/RespondKitUI"),
    .testTarget(
      name: "RespondKitTests", dependencies: ["RespondKitCore"], path: "native",
      exclude: ["android", "examples", "swift/Sources"],
      sources: ["swift/Tests"], resources: [.copy("fixtures")]),
  ]
)
