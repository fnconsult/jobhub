Pod::Spec.new do |s|
  s.name           = 'JobbboxDropTarget'
  s.version        = '1.0.0'
  s.summary        = 'The conversation box of the Jobbbox app, taking a document or a link dropped on it on iPad.'
  s.description    = s.summary
  s.author         = ''
  s.homepage       = 'https://jobbbox.ai'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
