package com.omega.platform.web;

/**
 * Expresiones regulares compartidas para validación estricta de entradas en gateway y servicios.
 */
public final class ValidationPatterns {

    private ValidationPatterns() {
    }

    /** Correo electrónico RFC práctico: exige parte local limpia, dominio válido (<=5 etiquetas) y bloquea ruido aleatorio. */
    public static final String STRICT_EMAIL_REGEX =
            "^(?i)(?=.{5,255}$)(?!.*\\.\\.)(?!.*([a-z])\\1{3})(?!.*[bcdfghjklmnpqrstvwxz]{6})(?!.*(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\\d+[a-z]+\\d+)(?!.*@(?:[^@]*\\.)?[a-z0-9]\\.(?:[^@]*\\.)?[a-z0-9]\\.)[a-z0-9]+(?:[._+-][a-z0-9]+){0,3}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,4}[a-z]{2,24}$";

    /** Versión en minúsculas para validación de activos OSINT normalizados. */
    public static final String STRICT_EMAIL_LOWER_REGEX =
            "^(?=.{5,255}$)(?!.*\\.\\.)(?!.*([a-z])\\1{3})(?!.*[bcdfghjklmnpqrstvwxz]{6})(?!.*(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\\d+[a-z]+\\d+)(?!.*@(?:[^@]*\\.)?[a-z0-9]\\.(?:[^@]*\\.)?[a-z0-9]\\.)[a-z0-9]+(?:[._+-][a-z0-9]+){0,3}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,4}[a-z]{2,24}$";

    /** Dominio DNS válido en minúsculas (<=5 etiquetas, sin punycode inválido ni ruido aleatorio). */
    public static final String STRICT_DOMAIN_LOWER_REGEX =
            "^(?=.{4,253}$)(?!.*(?:(?<!xn)--))(?!.*([a-z])\\1{3})(?!.*[bcdfghjklmnpqrstvwxz]{6})(?!.*(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\\d+[a-z]+\\d+)(?!^(?:[^.]*\\.)?[a-z0-9]\\.(?:[^.]*\\.)?[a-z0-9]\\.)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.){1,4}[a-z]{2,24}$";

    /** Nombre humano válido: letras Unicode, espacios simples, guion, punto abreviatura o apóstrofo; sin dígitos ni símbolos. */
    public static final String PERSON_NAME_REGEX =
            "^(?iu)(?=(?:.*\\p{L}){2,})(?!.*\\s{2})(?!.*[.'’\\-]{2})(?!.*(\\p{L})\\1{3})(?!.*[bcdfghjklmnñpqrstvwxz]{5})[\\p{L}][\\p{L}\\s.'’-]{0,198}[\\p{L}.]$";

    /** Organización obligatoria: mínimo 2 letras reales y caracteres corporativos habituales, sin HTML ni ruido aleatorio. */
    public static final String ORGANIZATION_NAME_REGEX =
            "^(?iu)(?=.{2,200}$)(?=(?:.*\\p{L}){2,})(?!.*\\s{2})(?!.*(?:\\.{2}|,{2}|'{2}|’{2}|--|\\.-|-\\.|/{2}|&{2}))(?!.*\\.\\d+\\.)(?!.*(?:\\.[^.]*){4,})(?!.*(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]{9,})[\\p{L}\\p{N}]*\\p{L}+\\p{N}+\\p{L}+\\p{N}+)(?!.*(\\p{L})\\1{3})(?!.*[bcdfghjklmnñpqrstvwxz]{5})[\\p{L}\\p{N}][\\p{L}\\p{N}\\s&'’.,/()-]{0,198}[\\p{L}\\p{N}.)]$";

    /** Organización opcional en registro estándar: admite vacío o formato corporativo válido. */
    public static final String OPTIONAL_ORGANIZATION_NAME_REGEX =
            "^(?iu)(?:\\s*|(?=.{2,200}$)(?=(?:.*\\p{L}){2,})(?!.*\\s{2})(?!.*(?:\\.{2}|,{2}|'{2}|’{2}|--|\\.-|-\\.|/{2}|&{2}))(?!.*\\.\\d+\\.)(?!.*(?:\\.[^.]*){4,})(?!.*(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]{9,})[\\p{L}\\p{N}]*\\p{L}+\\p{N}+\\p{L}+\\p{N}+)(?!.*(\\p{L})\\1{3})(?!.*[bcdfghjklmnñpqrstvwxz]{5})[\\p{L}\\p{N}][\\p{L}\\p{N}\\s&'’.,/()-]{0,198}[\\p{L}\\p{N}.)])$";

    /** Slug de tenant: minúsculas reales, dígitos y guiones simples entre 3 y 80 caracteres. */
    public static final String TENANT_SLUG_REGEX =
            "^(?=.{3,80}$)(?=(?:.*[a-z]){2,})(?!.*--)(?!.*([a-z])\\1{3})(?!.*[bcdfghjklmnpqrstvwxz]{6})(?!.*(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\\d+[a-z]+\\d+)[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$";

    /** Slug opcional en login. */
    public static final String OPTIONAL_TENANT_SLUG_REGEX =
            "^(?:\\s*|(?=.{3,80}$)(?=(?:.*[a-z]){2,})(?!.*--)(?!.*([a-z])\\1{3})(?!.*[bcdfghjklmnpqrstvwxz]{6})(?!.*(?<![a-z0-9])(?=[a-z0-9]{9,})[a-z0-9]*[a-z]+\\d+[a-z]+\\d+)[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?)$";

    /** Contraseña de alta: 12..128 caracteres sin espacios al inicio/final ni relleno trivial, con letra y dígito/símbolo. */
    public static final String STRONG_PASSWORD_REGEX =
            "^(?=.*\\p{L})(?=.*[\\p{N}\\p{Punct}\\p{S}])(?!.*[\\r\\n\\t])(?!.*(.)\\1{5})\\S.{10,126}\\S$";
}
