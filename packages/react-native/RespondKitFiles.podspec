require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'RespondKitFiles'
  s.version = package['version']
  s.summary = 'System file and photo import for RespondKit'
  s.homepage = 'https://respondkit.dev'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'RespondKit'
  s.source = { :git => 'https://github.com/xanthous-tech/RespondKit.git', :tag => "v#{s.version}" }
  s.platforms = { :ios => '15.1' }
  s.source_files = 'ios/**/*.{h,m,mm}'
  s.frameworks = 'PhotosUI', 'UniformTypeIdentifiers'
  s.dependency 'React-Core'
end
