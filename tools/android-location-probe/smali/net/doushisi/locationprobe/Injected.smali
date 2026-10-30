.class public Lnet/doushisi/locationprobe/Injected;
.super Landroid/content/BroadcastReceiver;

.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/content/BroadcastReceiver;-><init>()V
    return-void
.end method

.method public onReceive(Landroid/content/Context;Landroid/content/Intent;)V
    .locals 1
    const/4 v0, 0x1
    sput-boolean v0, Lnet/doushisi/locationprobe/Probe;->injected:Z
    return-void
.end method
