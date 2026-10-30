.class public Lnet/doushisi/standalone/StandaloneLocation;
.super Ljava/lang/Object;
.implements Landroid/location/LocationListener;

.field private static listener:Lnet/doushisi/standalone/StandaloneLocation;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public static start(Landroid/content/Context;)V
    .locals 1
    const-string v0, "gps"
    invoke-static {p0, v0}, Lnet/doushisi/standalone/StandaloneLocation;->startProvider(Landroid/content/Context;Ljava/lang/String;)V
    const-string v0, "network"
    invoke-static {p0, v0}, Lnet/doushisi/standalone/StandaloneLocation;->startProvider(Landroid/content/Context;Ljava/lang/String;)V
    return-void
.end method

# Each provider can fail independently (missing provider or approximate-only permission).
.method private static startProvider(Landroid/content/Context;Ljava/lang/String;)V
    .locals 9
    :try_start_0
    const-string v0, "location"
    invoke-virtual {p0, v0}, Landroid/content/Context;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v1
    check-cast v1, Landroid/location/LocationManager;
    sget-object v6, Lnet/doushisi/standalone/StandaloneLocation;->listener:Lnet/doushisi/standalone/StandaloneLocation;
    if-nez v6, :have_listener
    new-instance v6, Lnet/doushisi/standalone/StandaloneLocation;
    invoke-direct {v6}, Lnet/doushisi/standalone/StandaloneLocation;-><init>()V
    sput-object v6, Lnet/doushisi/standalone/StandaloneLocation;->listener:Lnet/doushisi/standalone/StandaloneLocation;
    :have_listener
    move-object v2, p1
    const-wide/16 v3, 0x1388
    const/4 v5, 0x0
    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;
    move-result-object v7
    invoke-virtual/range {v1 .. v7}, Landroid/location/LocationManager;->requestLocationUpdates(Ljava/lang/String;JFLandroid/location/LocationListener;Landroid/os/Looper;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :failure
    return-void
    :failure
    move-exception v0
    return-void
.end method

# Ask Android again on every read so revoked permissions cannot expose a cached precise fix.
.method public static getLatest(Landroid/content/Context;)Landroid/location/Location;
    .locals 7
    const-string v0, "gps"
    invoke-static {p0, v0}, Lnet/doushisi/standalone/StandaloneLocation;->lastKnown(Landroid/content/Context;Ljava/lang/String;)Landroid/location/Location;
    move-result-object v1
    const-string v0, "network"
    invoke-static {p0, v0}, Lnet/doushisi/standalone/StandaloneLocation;->lastKnown(Landroid/content/Context;Ljava/lang/String;)Landroid/location/Location;
    move-result-object v2
    if-eqz v2, :done
    if-eqz v1, :use_network
    invoke-virtual {v1}, Landroid/location/Location;->getElapsedRealtimeNanos()J
    move-result-wide v3
    invoke-virtual {v2}, Landroid/location/Location;->getElapsedRealtimeNanos()J
    move-result-wide v5
    cmp-long v0, v5, v3
    if-lez v0, :done
    :use_network
    move-object v1, v2
    :done
    return-object v1
.end method

.method private static lastKnown(Landroid/content/Context;Ljava/lang/String;)Landroid/location/Location;
    .locals 2
    :try_start_0
    const-string v0, "location"
    invoke-virtual {p0, v0}, Landroid/content/Context;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v0
    check-cast v0, Landroid/location/LocationManager;
    invoke-virtual {v0, p1}, Landroid/location/LocationManager;->isProviderEnabled(Ljava/lang/String;)Z
    move-result v1
    if-eqz v1, :unavailable
    invoke-virtual {v0, p1}, Landroid/location/LocationManager;->getLastKnownLocation(Ljava/lang/String;)Landroid/location/Location;
    move-result-object v1
    return-object v1
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :failure
    :failure
    move-exception v0
    :unavailable
    const/4 v1, 0x0
    return-object v1
.end method

.method public static stop(Landroid/content/Context;)V
    .locals 2
    :try_start_0
    sget-object v0, Lnet/doushisi/standalone/StandaloneLocation;->listener:Lnet/doushisi/standalone/StandaloneLocation;
    if-eqz v0, :done
    const-string v1, "location"
    invoke-virtual {p0, v1}, Landroid/content/Context;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;
    move-result-object v1
    check-cast v1, Landroid/location/LocationManager;
    invoke-virtual {v1, v0}, Landroid/location/LocationManager;->removeUpdates(Landroid/location/LocationListener;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :failure
    :done
    return-void
    :failure
    move-exception v0
    return-void
.end method

.method public onLocationChanged(Landroid/location/Location;)V
    .locals 0
    return-void
.end method

.method public onProviderEnabled(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public onProviderDisabled(Ljava/lang/String;)V
    .locals 0
    return-void
.end method

.method public onStatusChanged(Ljava/lang/String;ILandroid/os/Bundle;)V
    .locals 0
    return-void
.end method
