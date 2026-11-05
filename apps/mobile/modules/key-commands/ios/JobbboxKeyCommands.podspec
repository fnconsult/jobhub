Pod::Spec.new do |s|
  s.name           = 'JobbboxKeyCommands'
  s.version        = '1.0.0'
  s.summary        = 'The hardware keyboard shortcuts of the Jobbbox app, listed in the iPad command panel.'
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
