.class public Lnet/doushisi/standalone/AcceptanceReceiver;
.super Landroid/content/BroadcastReceiver;
.source "AcceptanceReceiver.java"


# static fields
.field private static pending:Ljava/lang/String;


# direct methods
.method public constructor <init>()V
    .locals 0

    invoke-direct {p0}, Landroid/content/BroadcastReceiver;-><init>()V

    return-void
.end method


# static methods
.method public static takePending()Ljava/lang/String;
    .locals 2

    sget-object v0, Lnet/doushisi/standalone/AcceptanceReceiver;->pending:Ljava/lang/String;

    const/4 v1, 0x0
    sput-object v1, Lnet/doushisi/standalone/AcceptanceReceiver;->pending:Ljava/lang/String;

    return-object v0
.end method


# virtual methods
.method private static getActivity()Lorg/cocos2dx/javascript/AppActivity;
    .locals 3

    :try_start_0
    const-class v0, Lorg/cocos2dx/javascript/AppActivity;

    const-string v1, "that"

    invoke-virtual {v0, v1}, Ljava/lang/Class;->getDeclaredField(Ljava/lang/String;)Ljava/lang/reflect/Field;
    move-result-object v0

    const/4 v1, 0x1

    invoke-virtual {v0, v1}, Ljava/lang/reflect/Field;->setAccessible(Z)V

    const/4 v1, 0x0

    invoke-virtual {v0, v1}, Ljava/lang/reflect/Field;->get(Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object v0

    check-cast v0, Lorg/cocos2dx/javascript/AppActivity;
    return-object v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    move-exception v0

    const/4 v0, 0x0
    return-object v0
.end method

.method public onReceive(Landroid/content/Context;Landroid/content/Intent;)V
    .locals 8

    const-string v0, "net.doushisi.standalone.ACCEPTANCE"

    invoke-virtual {p2}, Landroid/content/Intent;->getAction()Ljava/lang/String;
    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v1

    if-eqz v1, :done

    const-string v1, "command"

    invoke-virtual {p2, v1}, Landroid/content/Intent;->getStringExtra(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v1

    if-eqz v1, :done

    new-instance v2, Ljava/lang/StringBuilder;
    invoke-direct {v2}, Ljava/lang/StringBuilder;-><init>()V

    const-string v3, "window.LocalAcceptance&&window.LocalAcceptance.dispatch("
    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-static {v1}, Lorg/json/JSONObject;->quote(Ljava/lang/String;)Ljava/lang/String;
    move-result-object v3
    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v3, ");"
    invoke-virtual {v2, v3}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v2}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v2

    invoke-static {}, Lnet/doushisi/standalone/AcceptanceReceiver;->getActivity()Lorg/cocos2dx/javascript/AppActivity;
    move-result-object v3

    if-nez v3, :dispatch

    # The activity is not up yet, so queue the command and let the client drain it after boot.
    sput-object v1, Lnet/doushisi/standalone/AcceptanceReceiver;->pending:Ljava/lang/String;

    new-instance v4, Landroid/content/Intent;
    invoke-direct {v4}, Landroid/content/Intent;-><init>()V

    const-string v5, "org.cocos2dx.javascript.AppActivity"
    invoke-virtual {v4, p1, v5}, Landroid/content/Intent;->setClassName(Landroid/content/Context;Ljava/lang/String;)Landroid/content/Intent;

    const/high16 v5, 0x10000000
    invoke-virtual {v4, v5}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;

    invoke-virtual {p1, v4}, Landroid/content/Context;->startActivity(Landroid/content/Intent;)V

    const-string v4, "DSS_ACCEPTANCE_BRIDGE"
    const-string v5, "queued for cold start"
    invoke-static {v4, v5}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I

    goto :done

    :dispatch

    invoke-static {v2}, Lorg/cocos2dx/javascript/AppActivity;->JSrunOnGLThread(Ljava/lang/String;)V

    const-string v4, "DSS_ACCEPTANCE_BRIDGE"
    const-string v5, "broadcast dispatched"
    invoke-static {v4, v5}, Landroid/util/Log;->i(Ljava/lang/String;Ljava/lang/String;)I

    :done
    return-void
.end method
