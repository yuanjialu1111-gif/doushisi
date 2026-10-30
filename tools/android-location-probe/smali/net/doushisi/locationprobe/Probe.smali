.class public Lnet/doushisi/locationprobe/Probe;
.super Landroid/app/Instrumentation;

.field public static volatile injected:Z

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/app/Instrumentation;-><init>()V
    return-void
.end method

.method public onCreate(Landroid/os/Bundle;)V
    .locals 0
    invoke-super {p0, p1}, Landroid/app/Instrumentation;->onCreate(Landroid/os/Bundle;)V
    invoke-virtual {p0}, Landroid/app/Instrumentation;->start()V
    return-void
.end method

.method public onStart()V
    .locals 9
    invoke-virtual {p0}, Landroid/app/Instrumentation;->getTargetContext()Landroid/content/Context;
    move-result-object v0
    new-instance v1, Landroid/content/Intent;
    invoke-direct {v1}, Landroid/content/Intent;-><init>()V
    const-string v2, "org.cocos2dx.javascript.AppActivity"
    invoke-virtual {v1, v0, v2}, Landroid/content/Intent;->setClassName(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;
    const v2, 0x10000000
    invoke-virtual {v1, v2}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;
    invoke-virtual {p0, v1}, Landroid/app/Instrumentation;->startActivitySync(Landroid/content/Intent;)Landroid/app/Activity;
    move-result-object v0
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneLocation;->start(Landroid/content/Context;)V
    const/4 v2, 0x0
    sput-boolean v2, Lnet/doushisi/locationprobe/Probe;->injected:Z
    new-instance v7, Lnet/doushisi/locationprobe/Injected;
    invoke-direct {v7}, Lnet/doushisi/locationprobe/Injected;-><init>()V
    new-instance v8, Landroid/content/IntentFilter;
    const-string v2, "net.doushisi.locationprobe.INJECTED"
    invoke-direct {v8, v2}, Landroid/content/IntentFilter;-><init>(Ljava/lang/String;)V
    invoke-virtual {v0, v7, v8}, Landroid/content/Context;->registerReceiver(Landroid/content/BroadcastReceiver;Landroid/content/IntentFilter;)Landroid/content/Intent;
    new-instance v1, Landroid/os/Bundle;
    invoke-direct {v1}, Landroid/os/Bundle;-><init>()V
    const/16 v2, 0x64
    invoke-virtual {p0, v2, v1}, Landroid/app/Instrumentation;->sendStatus(ILandroid/os/Bundle;)V
    const/16 v5, 0x64
    :wait_injection
    sget-boolean v6, Lnet/doushisi/locationprobe/Probe;->injected:Z
    if-nez v6, :injected
    const-wide/16 v2, 0x64
    invoke-static {v2, v3}, Landroid/os/SystemClock;->sleep(J)V
    add-int/lit8 v5, v5, -0x1
    if-gtz v5, :wait_injection
    const-string v5, "error"
    const-string v6, "injection-handshake-timed-out"
    invoke-virtual {v1, v5, v6}, Landroid/os/Bundle;->putString(Ljava/lang/String;Ljava/lang/String;)V
    :injected
    invoke-virtual {v0, v7}, Landroid/content/Context;->unregisterReceiver(Landroid/content/BroadcastReceiver;)V
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneLocation;->getLatest(Landroid/content/Context;)Landroid/location/Location;
    move-result-object v4
    const-string v5, "provider"
    const-string v6, "none"
    if-eqz v4, :no_fix
    invoke-virtual {v4}, Landroid/location/Location;->getProvider()Ljava/lang/String;
    move-result-object v6
    invoke-virtual {v1, v5, v6}, Landroid/os/Bundle;->putString(Ljava/lang/String;Ljava/lang/String;)V
    const-string v5, "latitude"
    invoke-virtual {v4}, Landroid/location/Location;->getLatitude()D
    move-result-wide v2
    invoke-virtual {v1, v5, v2, v3}, Landroid/os/Bundle;->putDouble(Ljava/lang/String;D)V
    const-string v5, "longitude"
    invoke-virtual {v4}, Landroid/location/Location;->getLongitude()D
    move-result-wide v2
    invoke-virtual {v1, v5, v2, v3}, Landroid/os/Bundle;->putDouble(Ljava/lang/String;D)V
    goto :permissions
    :no_fix
    invoke-virtual {v1, v5, v6}, Landroid/os/Bundle;->putString(Ljava/lang/String;Ljava/lang/String;)V
    :permissions
    const-string v5, "android.permission.ACCESS_COARSE_LOCATION"
    invoke-virtual {v0, v5}, Landroid/content/Context;->checkSelfPermission(Ljava/lang/String;)I
    move-result v2
    const-string v5, "coarse"
    invoke-virtual {v1, v5, v2}, Landroid/os/Bundle;->putInt(Ljava/lang/String;I)V
    const-string v5, "android.permission.ACCESS_FINE_LOCATION"
    invoke-virtual {v0, v5}, Landroid/content/Context;->checkSelfPermission(Ljava/lang/String;)I
    move-result v2
    const-string v5, "fine"
    invoke-virtual {v1, v5, v2}, Landroid/os/Bundle;->putInt(Ljava/lang/String;I)V
    invoke-static {v0}, Lnet/doushisi/standalone/StandaloneLocation;->stop(Landroid/content/Context;)V
    const/4 v2, -0x1
    invoke-virtual {p0, v2, v1}, Landroid/app/Instrumentation;->finish(ILandroid/os/Bundle;)V
    return-void
.end method
