package com.omega.platform.security;

import java.util.Optional;
import java.util.UUID;

/**
 * Contexto de aislamiento por tenant asociado estrictamente al hilo actual del request HTTP.
 * Siempre debe limpiarse en bloque finally dentro del filtro de autenticación JWT.
 */
public final class TenantContext {

    private static final ThreadLocal<TenantScope> CURRENT = new ThreadLocal<>();

    private TenantContext() {
    }

    public static void set(TenantScope scope) {
        CURRENT.set(scope);
    }

    public static Optional<TenantScope> get() {
        return Optional.ofNullable(CURRENT.get());
    }

    public static UUID requireTenantId() {
        return get()
                .map(TenantScope::tenantId)
                .orElseThrow(() -> new IllegalStateException("Contexto de tenant no establecido en el hilo actual"));
    }

    public static UUID requireUserId() {
        return get()
                .map(TenantScope::userId)
                .orElseThrow(() -> new IllegalStateException("Usuario autenticado no establecido en TenantContext"));
    }

    public static void clear() {
        CURRENT.remove();
    }
}
