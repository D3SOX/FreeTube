{
  "targets": [{
    "target_name": "windows_share",
    "sources": ["share.cpp"],
    "defines": ["NAPI_VERSION=8", "NOMINMAX"],
    "libraries": ["windowsapp.lib"],
    "msvs_settings": {
      "VCCLCompilerTool": {
        "AdditionalOptions": ["/std:c++20", "/EHsc"],
        "ExceptionHandling": 1
      }
    }
  }]
}
