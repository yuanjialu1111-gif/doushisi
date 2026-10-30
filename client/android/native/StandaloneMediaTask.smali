.class final Lnet/doushisi/standalone/StandaloneMediaTask;
.super Ljava/lang/Object;
.implements Ljava/lang/Runnable;

# One Runnable for the three thread hops of StandaloneMedia:
#   kind 1  UI thread          StandaloneMedia.launch(activity, text)
#   kind 2  background thread  StandaloneMedia.process(activity, uri, file)
#   kind 3  Cocos GL thread    Cocos2dxJavascriptJavaBridge.evalString(text)
# run() swallows every Throwable.

.field private kind:I
.field private activity:Landroid/app/Activity;
.field private text:Ljava/lang/String;
.field private uri:Landroid/net/Uri;
.field private file:Ljava/io/File;

.method constructor <init>(Landroid/app/Activity;Ljava/lang/String;)V
    .locals 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    const/4 v0, 0x1
    iput v0, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->kind:I
    iput-object p1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->activity:Landroid/app/Activity;
    iput-object p2, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->text:Ljava/lang/String;
    return-void
.end method

.method constructor <init>(Landroid/app/Activity;Landroid/net/Uri;Ljava/io/File;)V
    .locals 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    const/4 v0, 0x2
    iput v0, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->kind:I
    iput-object p1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->activity:Landroid/app/Activity;
    iput-object p2, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->uri:Landroid/net/Uri;
    iput-object p3, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->file:Ljava/io/File;
    return-void
.end method

.method constructor <init>(Ljava/lang/String;)V
    .locals 1
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    const/4 v0, 0x3
    iput v0, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->kind:I
    iput-object p1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->text:Ljava/lang/String;
    return-void
.end method

.method public run()V
    .locals 4
    :try_start_0
    iget v0, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->kind:I
    const/4 v1, 0x1
    if-ne v0, v1, :not_launch
    iget-object v1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->activity:Landroid/app/Activity;
    iget-object v2, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->text:Ljava/lang/String;
    invoke-static {v1, v2}, Lnet/doushisi/standalone/StandaloneMedia;->launch(Landroid/app/Activity;Ljava/lang/String;)V
    return-void
    :not_launch
    const/4 v1, 0x2
    if-ne v0, v1, :not_process
    iget-object v1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->activity:Landroid/app/Activity;
    iget-object v2, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->uri:Landroid/net/Uri;
    iget-object v3, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->file:Ljava/io/File;
    invoke-static {v1, v2, v3}, Lnet/doushisi/standalone/StandaloneMedia;->process(Landroid/app/Activity;Landroid/net/Uri;Ljava/io/File;)V
    return-void
    :not_process
    iget-object v1, p0, Lnet/doushisi/standalone/StandaloneMediaTask;->text:Ljava/lang/String;
    invoke-static {v1}, Lorg/cocos2dx/lib/Cocos2dxJavascriptJavaBridge;->evalString(Ljava/lang/String;)I
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :failure
    return-void
    :failure
    move-exception v0
    return-void
.end method
