.class public final Lnet/doushisi/standalone/StandaloneMedia;
.super Ljava/lang/Object;

# Album / camera picker for the profile photo.
#
# JS (GL thread):
#   jsb.reflection.callStaticMethod('net/doushisi/standalone/StandaloneMedia', 'pick',
#       '(Ljava/lang/String;)V', 'album' | 'camera')
# Result (GL thread, exactly once per pick that reaches Android):
#   window.StandaloneNative.onImage(base64Jpeg, error)
#     success: base64Jpeg = JPEG (longest edge <= 512, quality 85, no EXIF), error = ""
#     failure: base64Jpeg = "", error = "cancelled" | "permission" | "failed"
#
# AppActivity forwards onActivityResult / onRequestPermissionsResult here (see
# tools/client-native-patch.mjs). Every path catches Throwable so a picker problem can never
# crash the game. The FileProvider authority must match AndroidManifest.xml.

.field public static final AUTHORITY:Ljava/lang/String; = "net.doushisi.standalone.standalonemedia"
.field public static final REQUEST_ALBUM:I = 0x5d01
.field public static final REQUEST_CAMERA:I = 0x5d02
.field public static final REQUEST_CAMERA_PERMISSION:I = 0x5d03
.field public static final MAX_EDGE:I = 0x200
.field public static final JPEG_QUALITY:I = 0x55

.method private constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

# GL thread entry point: hop to the UI thread before touching activities.
.method public static pick(Ljava/lang/String;)V
    .locals 3
    :try_start_0
    invoke-static {}, Lorg/cocos2dx/lib/Cocos2dxActivity;->getContext()Landroid/content/Context;
    move-result-object v0
    instance-of v1, v0, Landroid/app/Activity;
    if-eqz v1, :no_activity
    check-cast v0, Landroid/app/Activity;
    new-instance v1, Lnet/doushisi/standalone/StandaloneMediaTask;
    invoke-direct {v1, v0, p0}, Lnet/doushisi/standalone/StandaloneMediaTask;-><init>(Landroid/app/Activity;Ljava/lang/String;)V
    invoke-virtual {v0, v1}, Landroid/app/Activity;->runOnUiThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    return-void
    :failure
    move-exception v0
    :no_activity
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

# UI thread (StandaloneMediaTask kind 1).
.method public static launch(Landroid/app/Activity;Ljava/lang/String;)V
    .locals 2
    :try_start_0
    const-string v0, "album"
    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-eqz v0, :not_album
    new-instance v0, Landroid/content/Intent;
    const-string v1, "android.intent.action.GET_CONTENT"
    invoke-direct {v0, v1}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V
    const-string v1, "image/*"
    invoke-virtual {v0, v1}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;
    const-string v1, "android.intent.category.OPENABLE"
    invoke-virtual {v0, v1}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;
    const/16 v1, 0x5d01
    invoke-virtual {p0, v0, v1}, Landroid/app/Activity;->startActivityForResult(Landroid/content/Intent;I)V
    return-void
    :not_album
    const-string v0, "camera"
    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-eqz v0, :invalid
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneMedia;->needsCameraPermission(Landroid/app/Activity;)Z
    move-result v0
    if-eqz v0, :open_camera
    const-string v0, "android.permission.CAMERA"
    filled-new-array {v0}, [Ljava/lang/String;
    move-result-object v0
    const/16 v1, 0x5d03
    invoke-virtual {p0, v0, v1}, Landroid/app/Activity;->requestPermissions([Ljava/lang/String;I)V
    return-void
    :open_camera
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneMedia;->openCamera(Landroid/app/Activity;)V
    return-void
    :try_end_0
    .catch Ljava/lang/SecurityException; {:try_start_0 .. :try_end_0} :denied
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    :invalid
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
    :denied
    move-exception v0
    const-string v0, ""
    const-string v1, "permission"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
    :failure
    move-exception v0
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

# The system camera intent needs no permission unless the manifest declares CAMERA. Only ask
# when CAMERA is declared (requestedPermissions) and not yet granted.
.method private static needsCameraPermission(Landroid/app/Activity;)Z
    .locals 6
    const-string v0, "android.permission.CAMERA"
    invoke-virtual {p0, v0}, Landroid/content/Context;->checkSelfPermission(Ljava/lang/String;)I
    move-result v1
    if-eqz v1, :not_needed
    :try_start_0
    invoke-virtual {p0}, Landroid/content/Context;->getPackageManager()Landroid/content/pm/PackageManager;
    move-result-object v1
    invoke-virtual {p0}, Landroid/content/Context;->getPackageName()Ljava/lang/String;
    move-result-object v2
    const/16 v3, 0x1000
    invoke-virtual {v1, v2, v3}, Landroid/content/pm/PackageManager;->getPackageInfo(Ljava/lang/String;I)Landroid/content/pm/PackageInfo;
    move-result-object v1
    iget-object v1, v1, Landroid/content/pm/PackageInfo;->requestedPermissions:[Ljava/lang/String;
    if-eqz v1, :not_needed
    array-length v2, v1
    const/4 v3, 0x0
    :loop
    if-ge v3, v2, :not_needed
    aget-object v4, v1, v3
    invoke-virtual {v0, v4}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v5
    if-nez v5, :needed
    add-int/lit8 v3, v3, 0x1
    goto :loop
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :lookup_failed
    :needed
    const/4 v0, 0x1
    return v0
    :lookup_failed
    move-exception v0
    :not_needed
    const/4 v0, 0x0
    return v0
.end method

# UI thread. Throws on failure; callers map exceptions to "permission" / "failed".
.method private static openCamera(Landroid/app/Activity;)V
    .locals 4
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneMedia;->captureFile(Landroid/content/Context;)Ljava/io/File;
    move-result-object v0
    invoke-virtual {v0}, Ljava/io/File;->getParentFile()Ljava/io/File;
    move-result-object v1
    invoke-virtual {v1}, Ljava/io/File;->mkdirs()Z
    invoke-virtual {v0}, Ljava/io/File;->delete()Z
    const-string v1, "net.doushisi.standalone.standalonemedia"
    invoke-static {p0, v1, v0}, Landroid/support/v4/content/FileProvider;->getUriForFile(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;
    move-result-object v1
    new-instance v2, Landroid/content/Intent;
    const-string v3, "android.media.action.IMAGE_CAPTURE"
    invoke-direct {v2, v3}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V
    const-string v3, "output"
    invoke-virtual {v2, v3, v1}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Landroid/os/Parcelable;)Landroid/content/Intent;
    const/4 v3, 0x3
    invoke-virtual {v2, v3}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;
    const/16 v3, 0x5d02
    invoke-virtual {p0, v2, v3}, Landroid/app/Activity;->startActivityForResult(Landroid/content/Intent;I)V
    return-void
.end method

# <cacheDir>/standalone-camera/capture.jpg, shared through res/xml/standalone_media_paths.xml.
.method private static captureFile(Landroid/content/Context;)Ljava/io/File;
    .locals 3
    invoke-virtual {p0}, Landroid/content/Context;->getCacheDir()Ljava/io/File;
    move-result-object v1
    new-instance v0, Ljava/io/File;
    const-string v2, "standalone-camera"
    invoke-direct {v0, v1, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    new-instance v1, Ljava/io/File;
    const-string v2, "capture.jpg"
    invoke-direct {v1, v0, v2}, Ljava/io/File;-><init>(Ljava/io/File;Ljava/lang/String;)V
    return-object v1
.end method

# Forwarded from AppActivity.onRequestPermissionsResult. Returns true when the request code is
# ours, so the activity skips its location handling.
.method public static onRequestPermissionsResult(Landroid/app/Activity;I[Ljava/lang/String;[I)Z
    .locals 2
    const/16 v0, 0x5d03
    if-eq p1, v0, :mine
    const/4 v0, 0x0
    return v0
    :mine
    :try_start_0
    if-eqz p3, :denied
    array-length v0, p3
    if-eqz v0, :denied
    const/4 v0, 0x0
    aget v0, p3, v0
    if-nez v0, :denied
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneMedia;->openCamera(Landroid/app/Activity;)V
    :try_end_0
    .catch Ljava/lang/SecurityException; {:try_start_0 .. :try_end_0} :denied_error
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    const/4 v0, 0x1
    return v0
    :denied_error
    move-exception v0
    :denied
    const-string v0, ""
    const-string v1, "permission"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    const/4 v0, 0x1
    return v0
    :failure
    move-exception v0
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    const/4 v0, 0x1
    return v0
.end method

# Forwarded from the start of AppActivity.onActivityResult (UI thread). Other request codes are
# ignored. Decoding happens on a background thread.
.method public static onActivityResult(Landroid/app/Activity;IILandroid/content/Intent;)V
    .locals 4
    :try_start_0
    const/16 v0, 0x5d01
    if-eq p1, v0, :album
    const/16 v0, 0x5d02
    if-eq p1, v0, :camera
    return-void
    :album
    const/4 v0, -0x1
    if-ne p2, v0, :cancelled
    if-eqz p3, :failed
    invoke-virtual {p3}, Landroid/content/Intent;->getData()Landroid/net/Uri;
    move-result-object v1
    if-eqz v1, :failed
    const/4 v2, 0x0
    goto :process
    :camera
    invoke-static {p0}, Lnet/doushisi/standalone/StandaloneMedia;->captureFile(Landroid/content/Context;)Ljava/io/File;
    move-result-object v2
    const/4 v0, -0x1
    if-ne p2, v0, :camera_cancelled
    const/4 v1, 0x0
    :process
    new-instance v3, Lnet/doushisi/standalone/StandaloneMediaTask;
    invoke-direct {v3, p0, v1, v2}, Lnet/doushisi/standalone/StandaloneMediaTask;-><init>(Landroid/app/Activity;Landroid/net/Uri;Ljava/io/File;)V
    new-instance v0, Ljava/lang/Thread;
    invoke-direct {v0, v3}, Ljava/lang/Thread;-><init>(Ljava/lang/Runnable;)V
    invoke-virtual {v0}, Ljava/lang/Thread;->start()V
    return-void
    :camera_cancelled
    invoke-static {v2}, Lnet/doushisi/standalone/StandaloneMedia;->deleteQuietly(Ljava/io/File;)V
    :cancelled
    const-string v0, ""
    const-string v1, "cancelled"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    :failure
    move-exception v0
    :failed
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
.end method

# Background thread (StandaloneMediaTask kind 2). Uri for album picks, File for camera shots.
.method public static process(Landroid/app/Activity;Landroid/net/Uri;Ljava/io/File;)V
    .locals 2
    const/4 v0, 0x0
    :try_start_0
    invoke-static {p0, p1, p2}, Lnet/doushisi/standalone/StandaloneMedia;->encode(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)Ljava/lang/String;
    move-result-object v0
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :encode_failed
    :encoded
    invoke-static {p2}, Lnet/doushisi/standalone/StandaloneMedia;->deleteQuietly(Ljava/io/File;)V
    if-eqz v0, :failed
    const-string v1, ""
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
    :failed
    const-string v0, ""
    const-string v1, "failed"
    invoke-static {v0, v1}, Lnet/doushisi/standalone/StandaloneMedia;->deliver(Ljava/lang/String;Ljava/lang/String;)V
    return-void
    :encode_failed
    move-exception v1
    const/4 v0, 0x0
    goto :encoded
.end method

# Decode with power-of-two subsampling, apply EXIF rotation, scale the longest edge to <= 512,
# flatten onto white, re-encode as JPEG 85 (drops all EXIF/GPS metadata), Base64 NO_WRAP.
# Returns null when the input is not a decodable image.
.method private static encode(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)Ljava/lang/String;
    .locals 8
    new-instance v0, Landroid/graphics/BitmapFactory$Options;
    invoke-direct {v0}, Landroid/graphics/BitmapFactory$Options;-><init>()V
    const/4 v1, 0x1
    iput-boolean v1, v0, Landroid/graphics/BitmapFactory$Options;->inJustDecodeBounds:Z
    invoke-static {p0, p1, p2, v0}, Lnet/doushisi/standalone/StandaloneMedia;->decode(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;Landroid/graphics/BitmapFactory$Options;)Landroid/graphics/Bitmap;
    iget v2, v0, Landroid/graphics/BitmapFactory$Options;->outWidth:I
    iget v3, v0, Landroid/graphics/BitmapFactory$Options;->outHeight:I
    if-lez v2, :invalid
    if-lez v3, :invalid
    if-ge v2, v3, :have_longest
    move v2, v3
    :have_longest
    const/4 v4, 0x1
    :sample_loop
    mul-int/lit8 v5, v4, 0x2
    div-int v6, v2, v5
    const/16 v7, 0x200
    if-lt v6, v7, :sample_done
    move v4, v5
    goto :sample_loop
    :sample_done
    new-instance v0, Landroid/graphics/BitmapFactory$Options;
    invoke-direct {v0}, Landroid/graphics/BitmapFactory$Options;-><init>()V
    iput v4, v0, Landroid/graphics/BitmapFactory$Options;->inSampleSize:I
    invoke-static {p0, p1, p2, v0}, Lnet/doushisi/standalone/StandaloneMedia;->decode(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;Landroid/graphics/BitmapFactory$Options;)Landroid/graphics/Bitmap;
    move-result-object v6
    if-eqz v6, :invalid
    invoke-static {p0, p1, p2}, Lnet/doushisi/standalone/StandaloneMedia;->rotation(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)I
    move-result v7
    invoke-static {v6, v7}, Lnet/doushisi/standalone/StandaloneMedia;->scaleAndRotate(Landroid/graphics/Bitmap;I)Landroid/graphics/Bitmap;
    move-result-object v6
    new-instance v0, Ljava/io/ByteArrayOutputStream;
    invoke-direct {v0}, Ljava/io/ByteArrayOutputStream;-><init>()V
    sget-object v1, Landroid/graphics/Bitmap$CompressFormat;->JPEG:Landroid/graphics/Bitmap$CompressFormat;
    const/16 v2, 0x55
    invoke-virtual {v6, v1, v2, v0}, Landroid/graphics/Bitmap;->compress(Landroid/graphics/Bitmap$CompressFormat;ILjava/io/OutputStream;)Z
    move-result v1
    invoke-virtual {v6}, Landroid/graphics/Bitmap;->recycle()V
    if-eqz v1, :invalid
    invoke-virtual {v0}, Ljava/io/ByteArrayOutputStream;->toByteArray()[B
    move-result-object v1
    const/4 v2, 0x2
    invoke-static {v1, v2}, Landroid/util/Base64;->encodeToString([BI)Ljava/lang/String;
    move-result-object v1
    return-object v1
    :invalid
    const/4 v1, 0x0
    return-object v1
.end method

# Opens a fresh stream, decodes with the given options and always closes the stream.
.method private static decode(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;Landroid/graphics/BitmapFactory$Options;)Landroid/graphics/Bitmap;
    .locals 3
    invoke-static {p0, p1, p2}, Lnet/doushisi/standalone/StandaloneMedia;->openStream(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)Ljava/io/InputStream;
    move-result-object v0
    const/4 v1, 0x0
    :try_start_0
    invoke-static {v0, v1, p3}, Landroid/graphics/BitmapFactory;->decodeStream(Ljava/io/InputStream;Landroid/graphics/Rect;Landroid/graphics/BitmapFactory$Options;)Landroid/graphics/Bitmap;
    move-result-object v1
    :try_end_0
    .catchall {:try_start_0 .. :try_end_0} :close_and_rethrow
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneMedia;->closeQuietly(Ljava/io/Closeable;)V
    return-object v1
    :close_and_rethrow
    move-exception v2
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneMedia;->closeQuietly(Ljava/io/Closeable;)V
    throw v2
.end method

.method private static openStream(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)Ljava/io/InputStream;
    .locals 2
    if-eqz p2, :from_uri
    new-instance v0, Ljava/io/FileInputStream;
    invoke-direct {v0, p2}, Ljava/io/FileInputStream;-><init>(Ljava/io/File;)V
    return-object v0
    :from_uri
    invoke-virtual {p0}, Landroid/content/Context;->getContentResolver()Landroid/content/ContentResolver;
    move-result-object v0
    invoke-virtual {v0, p1}, Landroid/content/ContentResolver;->openInputStream(Landroid/net/Uri;)Ljava/io/InputStream;
    move-result-object v0
    if-nez v0, :done
    new-instance v0, Ljava/io/FileNotFoundException;
    const-string v1, "no stream"
    invoke-direct {v0, v1}, Ljava/io/FileNotFoundException;-><init>(Ljava/lang/String;)V
    throw v0
    :done
    return-object v0
.end method

# EXIF orientation in degrees (0 when missing or unreadable). ExifInterface(InputStream) is API 24+.
.method private static rotation(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)I
    .locals 4
    const/4 v0, 0x0
    :try_start_0
    invoke-static {p0, p1, p2}, Lnet/doushisi/standalone/StandaloneMedia;->openStream(Landroid/content/Context;Landroid/net/Uri;Ljava/io/File;)Ljava/io/InputStream;
    move-result-object v0
    new-instance v1, Landroid/media/ExifInterface;
    invoke-direct {v1, v0}, Landroid/media/ExifInterface;-><init>(Ljava/io/InputStream;)V
    const-string v2, "Orientation"
    const/4 v3, 0x1
    invoke-virtual {v1, v2, v3}, Landroid/media/ExifInterface;->getAttributeInt(Ljava/lang/String;I)I
    move-result v1
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneMedia;->closeQuietly(Ljava/io/Closeable;)V
    const/4 v2, 0x6
    if-ne v1, v2, :not_90
    const/16 v0, 0x5a
    return v0
    :not_90
    const/4 v2, 0x3
    if-ne v1, v2, :not_180
    const/16 v0, 0xb4
    return v0
    :not_180
    const/16 v2, 0x8
    if-ne v1, v2, :none
    const/16 v0, 0x10e
    return v0
    :failure
    move-exception v1
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneMedia;->closeQuietly(Ljava/io/Closeable;)V
    :none
    const/4 v0, 0x0
    return v0
.end method

# Scale so the longest edge is <= 512 (never upscale), rotate, then draw onto an opaque white
# ARGB_8888 bitmap so transparent PNGs do not turn black as JPEG. Recycles the inputs.
.method private static scaleAndRotate(Landroid/graphics/Bitmap;I)Landroid/graphics/Bitmap;
    .locals 9
    invoke-virtual {p0}, Landroid/graphics/Bitmap;->getWidth()I
    move-result v3
    invoke-virtual {p0}, Landroid/graphics/Bitmap;->getHeight()I
    move-result v4
    move v0, v3
    if-ge v0, v4, :longest_ready
    move v0, v4
    :longest_ready
    int-to-float v0, v0
    const/high16 v2, 0x44000000    # 512.0f
    div-float v2, v2, v0
    const/high16 v1, 0x3f800000    # 1.0f
    cmpl-float v0, v2, v1
    if-lez v0, :scale_ready
    move v2, v1
    :scale_ready
    new-instance v5, Landroid/graphics/Matrix;
    invoke-direct {v5}, Landroid/graphics/Matrix;-><init>()V
    invoke-virtual {v5, v2, v2}, Landroid/graphics/Matrix;->postScale(FF)Z
    if-eqz p1, :no_rotate
    int-to-float v0, p1
    invoke-virtual {v5, v0}, Landroid/graphics/Matrix;->postRotate(F)Z
    :no_rotate
    move-object v0, p0
    const/4 v1, 0x0
    const/4 v2, 0x0
    const/4 v6, 0x1
    invoke-static/range {v0 .. v6}, Landroid/graphics/Bitmap;->createBitmap(Landroid/graphics/Bitmap;IIIILandroid/graphics/Matrix;Z)Landroid/graphics/Bitmap;
    move-result-object v7
    invoke-virtual {v7}, Landroid/graphics/Bitmap;->getWidth()I
    move-result v3
    invoke-virtual {v7}, Landroid/graphics/Bitmap;->getHeight()I
    move-result v4
    sget-object v0, Landroid/graphics/Bitmap$Config;->ARGB_8888:Landroid/graphics/Bitmap$Config;
    invoke-static {v3, v4, v0}, Landroid/graphics/Bitmap;->createBitmap(IILandroid/graphics/Bitmap$Config;)Landroid/graphics/Bitmap;
    move-result-object v8
    new-instance v5, Landroid/graphics/Canvas;
    invoke-direct {v5, v8}, Landroid/graphics/Canvas;-><init>(Landroid/graphics/Bitmap;)V
    const/4 v0, -0x1
    invoke-virtual {v5, v0}, Landroid/graphics/Canvas;->drawColor(I)V
    const/4 v0, 0x0
    const/4 v1, 0x0
    const/4 v2, 0x0
    invoke-virtual {v5, v7, v0, v1, v2}, Landroid/graphics/Canvas;->drawBitmap(Landroid/graphics/Bitmap;FFLandroid/graphics/Paint;)V
    if-eq v7, p0, :source_reused
    invoke-virtual {v7}, Landroid/graphics/Bitmap;->recycle()V
    :source_reused
    invoke-virtual {p0}, Landroid/graphics/Bitmap;->recycle()V
    return-object v8
.end method

# Any thread. Queues window.StandaloneNative.onImage(...) on the Cocos GL thread.
# base64 / error only ever contain [A-Za-z0-9+/=] or fixed lowercase words: no escaping needed.
.method public static deliver(Ljava/lang/String;Ljava/lang/String;)V
    .locals 3
    :try_start_0
    new-instance v0, Ljava/lang/StringBuilder;
    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V
    const-string v1, "window.StandaloneNative&&window.StandaloneNative.onImage&&window.StandaloneNative.onImage(\""
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0, p0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v1, "\",\""
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0, p1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    const-string v1, "\");"
    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v0
    invoke-static {}, Lorg/cocos2dx/lib/Cocos2dxActivity;->getContext()Landroid/content/Context;
    move-result-object v1
    check-cast v1, Lorg/cocos2dx/lib/Cocos2dxActivity;
    new-instance v2, Lnet/doushisi/standalone/StandaloneMediaTask;
    invoke-direct {v2, v0}, Lnet/doushisi/standalone/StandaloneMediaTask;-><init>(Ljava/lang/String;)V
    invoke-virtual {v1, v2}, Lorg/cocos2dx/lib/Cocos2dxActivity;->runOnGLThread(Ljava/lang/Runnable;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    return-void
    :failure
    move-exception v0
    return-void
.end method

.method private static deleteQuietly(Ljava/io/File;)V
    .locals 1
    if-eqz p0, :done
    :try_start_0
    invoke-virtual {p0}, Ljava/io/File;->delete()Z
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    :done
    return-void
    :failure
    move-exception v0
    return-void
.end method

.method private static closeQuietly(Ljava/io/Closeable;)V
    .locals 1
    if-eqz p0, :done
    :try_start_0
    invoke-interface {p0}, Ljava/io/Closeable;->close()V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    :done
    return-void
    :failure
    move-exception v0
    return-void
.end method
