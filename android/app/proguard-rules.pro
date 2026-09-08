# Capacitor and WorkManager supply their own consumer keep rules.
# Capacitor's rules keep plugin classes but not their runtime annotation types.
# R8 full mode otherwise treats plugin permission metadata as null.
-keep @interface com.getcapacitor.annotation.** { *; }

# Commons Compress registers ZIP extra fields with Class.newInstance(). Keep
# their no-argument constructors and concrete classes for runtime extraction.
-keep,allowobfuscation class org.apache.commons.compress.archivers.zip.** implements org.apache.commons.compress.archivers.zip.ZipExtraField {
    public <init>();
}

# Pairing always selects ZXing. The barcode AAR also contains an unused ML Kit
# backend whose proprietary dependencies are deliberately excluded in Gradle.
-dontwarn com.google.android.gms.tasks.OnFailureListener
-dontwarn com.google.android.gms.tasks.OnSuccessListener
-dontwarn com.google.android.gms.tasks.Task
-dontwarn com.google.mlkit.vision.barcode.BarcodeScanner
-dontwarn com.google.mlkit.vision.barcode.BarcodeScannerOptions$Builder
-dontwarn com.google.mlkit.vision.barcode.BarcodeScannerOptions
-dontwarn com.google.mlkit.vision.barcode.BarcodeScanning
-dontwarn com.google.mlkit.vision.barcode.common.Barcode
-dontwarn com.google.mlkit.vision.common.InputImage

# The barcode plugin constructs its Kotlin parameters directly; its AAR also
# carries Gson field annotations, but the app does not use Gson serialization.
-dontwarn com.google.gson.annotations.SerializedName
