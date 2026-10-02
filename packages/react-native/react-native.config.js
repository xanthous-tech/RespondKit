export default {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: "./android",
        packageImportPath: "import dev.respondkit.files.RespondKitFilesPackage;",
        packageInstance: "new RespondKitFilesPackage()",
      },
    },
  },
};
