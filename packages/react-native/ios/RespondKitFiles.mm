#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <PhotosUI/PhotosUI.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface RespondKitFiles : NSObject <RCTBridgeModule, UIDocumentPickerDelegate, PHPickerViewControllerDelegate>
@property(nonatomic, copy) RCTPromiseResolveBlock resolve;
@property(nonatomic, copy) RCTPromiseRejectBlock reject;
@end
@implementation RespondKitFiles
RCT_EXPORT_MODULE(RespondKitFiles)
+ (BOOL)requiresMainQueueSetup { return NO; }
RCT_EXPORT_METHOD(pick:(NSString *)kind resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.resolve) { reject(@"file_import", @"A picker is already open", nil); return; }
    UIViewController *presenter = RCTPresentedViewController();
    if (!presenter) { reject(@"file_import", @"Cannot present file picker", nil); return; }
    self.resolve = resolve; self.reject = reject;
    if ([kind isEqualToString:@"photos"]) {
      PHPickerConfiguration *config = [[PHPickerConfiguration alloc] init];
      config.selectionLimit = 0;
      config.filter = [PHPickerFilter anyFilterMatchingSubfilters:@[PHPickerFilter.imagesFilter, PHPickerFilter.videosFilter]];
      PHPickerViewController *picker = [[PHPickerViewController alloc] initWithConfiguration:config];
      picker.delegate = self;
      [presenter presentViewController:picker animated:YES completion:nil];
    } else {
      UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:@[UTTypeItem] asCopy:YES];
      picker.allowsMultipleSelection = YES; picker.delegate = self;
      [presenter presentViewController:picker animated:YES completion:nil];
    }
  });
}
- (NSDictionary *)stage:(NSURL *)source name:(NSString *)name error:(NSError **)error {
  BOOL access = [source startAccessingSecurityScopedResource];
  NSURL *directory = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:[@"respondkit-" stringByAppendingString:NSUUID.UUID.UUIDString]]];
  [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:error];
  NSURL *destination = [directory URLByAppendingPathComponent:name.lastPathComponent];
  BOOL copied = [NSFileManager.defaultManager copyItemAtURL:source toURL:destination error:error];
  if (access) [source stopAccessingSecurityScopedResource];
  if (!copied) return nil;
  NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:destination.path error:error];
  UTType *type = [UTType typeWithFilenameExtension:destination.pathExtension];
  return @{ @"uri": destination.absoluteString, @"name": destination.lastPathComponent,
            @"size": attributes[NSFileSize] ?: @0, @"contentType": type.preferredMIMEType ?: @"application/octet-stream" };
}
- (void)finish:(NSArray *)files error:(NSError *)error {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (error) { if (self.reject) self.reject(@"file_import", error.localizedDescription, error); }
    else { if (self.resolve) self.resolve(files); }
    self.resolve = nil; self.reject = nil;
  });
}
- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller { [self finish:@[] error:nil]; }
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    NSMutableArray *files = [NSMutableArray array]; NSError *error = nil;
    for (NSURL *url in urls) { NSDictionary *file = [self stage:url name:url.lastPathComponent error:&error]; if (file) [files addObject:file]; if (error) break; }
    [self finish:files error:error];
  });
}
- (void)picker:(PHPickerViewController *)picker didFinishPicking:(NSArray<PHPickerResult *> *)results {
  [picker dismissViewControllerAnimated:YES completion:nil];
  if (results.count == 0) { [self finish:@[] error:nil]; return; }
  dispatch_group_t group = dispatch_group_create(); NSMutableArray *files = [NSMutableArray array];
  __block NSError *failure = nil;
  for (PHPickerResult *result in results) {
    dispatch_group_enter(group);
    NSItemProvider *provider = result.itemProvider;
    NSString *identifier = provider.registeredTypeIdentifiers.firstObject;
    [provider loadFileRepresentationForTypeIdentifier:identifier completionHandler:^(NSURL *url, NSError *error) {
      NSError *copyError = error;
      NSDictionary *file = url ? [self stage:url name:url.lastPathComponent error:&copyError] : nil;
      @synchronized(files) { if (file) [files addObject:file]; if (copyError) failure = copyError; }
      dispatch_group_leave(group);
    }];
  }
  dispatch_group_notify(group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{ [self finish:files error:failure]; });
}
RCT_EXPORT_METHOD(readChunk:(NSString *)uri offset:(double)offset length:(double)length resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
    NSURL *url = [NSURL URLWithString:uri];
    NSString *path = url.URLByResolvingSymlinksInPath.path;
    NSString *prefix = [[[NSURL fileURLWithPath:NSTemporaryDirectory()] URLByResolvingSymlinksInPath].path stringByAppendingString:@"/respondkit-"];
    if (![path hasPrefix:prefix]) { reject(@"file_read", @"File is outside the import cache", nil); return; }
    NSError *error = nil;
    NSFileHandle *file = [NSFileHandle fileHandleForReadingFromURL:url error:&error];
    [file seekToOffset:(unsigned long long)offset error:&error];
    NSData *data = [file readDataUpToLength:(NSUInteger)length error:&error];
    [file closeAndReturnError:nil];
    if (error || data.length != (NSUInteger)length) reject(@"file_read", @"Cannot read file chunk", error);
    else resolve([data base64EncodedStringWithOptions:0]);
  });
}
@end
