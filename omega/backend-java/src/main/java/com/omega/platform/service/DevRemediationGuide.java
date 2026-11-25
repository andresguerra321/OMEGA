package com.omega.platform.service;

import java.util.*;

public final class DevRemediationGuide {
    private DevRemediationGuide() {}
    public record Guide(String basis,List<String> steps,String verification) {}
    public static Guide forFinding(String rule,String location) {
        String id=rule==null?"":rule.toUpperCase(Locale.ROOT);
        String where=DevProjectService.sanitizeText(location,300);
        List<String> steps;
        if(id.startsWith("SECRET-CREDENTIAL-")) steps=List.of(
            "Confirmar la credencial en " + where + " sin copiar su valor al informe, chat o ticket.",
            "Revocarla en el proveedor y emitir una nueva con los permisos mínimos; cambiarla solo en el archivo no invalida la anterior.",
            "Revisar el uso de esa credencial y retirarla del repositorio y su historial mediante el procedimiento del equipo.");
        else if(id.equals("NPM-POSTINSTALL-EXEC-01")) steps=List.of(
            "Revisar el hook de instalación señalado en " + where + " y el origen de las descargas o comandos detectados.",
            "Detener su ejecución automática hasta comprobar su propósito; no ejecutar el script para averiguar si es seguro.",
            "Retirar la ejecución remota innecesaria o sustituirla por un paso explícito, revisado y con artefactos verificables.");
        else if(id.equals("PYPI-SETUP-EXEC-01")) steps=List.of(
            "Revisar el código de instalación en " + where + " y las llamadas que descargan o ejecutan contenido.",
            "Evaluar el paquete en un entorno aislado sin credenciales ni acceso a datos del proyecto.",
            "Retirar el efecto secundario innecesario de la instalación y revisar el origen del paquete distribuido.");
        else if(id.equals("PKG-TYPOSQUAT-01")) steps=List.of(
            "Comparar el nombre declarado en " + where + " con la dependencia realmente requerida y su editor.",
            "Si fue un error de nombre, corregir el manifiesto y regenerar el archivo de bloqueo con la dependencia revisada.",
            "Si el paquete era intencional, documentar su procedencia antes de aceptarlo; la semejanza de nombres no confirma malware.");
        else if(id.equals("PKG-MALICIOUS-ADVISORY-01")) steps=List.of(
            "Revisar el identificador del aviso registrado por el analizador y contrastar el paquete de " + where + " con su alcance.",
            "Aislar el paquete señalado y revisar si sus scripts llegaron a ejecutarse en desarrollo o CI.",
            "Retirar o sustituir el paquete conforme al aviso verificado; no se inventa una versión segura si el catálogo no la informa.");
        else if(id.equals("SECRET-EXFIL-01")) steps=List.of(
            "Revisar en " + where + " qué datos intenta leer el código y a qué destino los envía.",
            "Interrumpir la transmisión no autorizada y revisar los secretos a los que tuvo acceso el proceso.",
            "Documentar la necesidad del envío legítimo o retirar el mecanismo y rotar las credenciales expuestas.");
        else if(id.equals("SCRIPT-NET-INDICATOR-01")) steps=List.of(
            "Identificar el destino de red en " + where + " y contrastarlo con las fuentes CTI indicadas por la evaluación.",
            "Comprobar el propósito del contacto y bloquearlo si se confirma que no es autorizado.",
            "Separar una coincidencia de indicador de una ejecución o exfiltración demostradas.");
        else if(id.equals("CODE-OBFUSCATION-01")) steps=List.of(
            "Revisar el bloque ofuscado de " + where + " sin ejecutarlo en el equipo de trabajo.",
            "Solicitar una versión legible o contrastar el artefacto con una compilación de procedencia verificable.",
            "Retirar el comportamiento no justificado o documentar por qué la ofuscación es necesaria.");
        else if(Set.of("PKG-NEW-OR-RECENT-01","PKG-MAINTAINER-CHANGE-01","PKG-TEMPORAL-CHAIN-01").contains(id)) steps=List.of(
            "Revisar los metadatos de procedencia y los cambios de mantenimiento citados para " + where + ".",
            "Comprobar la publicación y los cambios de la versión seleccionada antes de incorporarla al proyecto.",
            "Tratar la antigüedad o cambio de editor como una señal contextual, no como una vulnerabilidad confirmada.");
        else steps=List.of("Contrastar la regla " + id + " con la observación de " + where + ".",
            "Confirmar el comportamiento y documentar una corrección concreta o una aceptación motivada del riesgo.");
        return new Guide("Guía determinista de la regla " + id + "; comprobar la observación en el contexto del proyecto.",steps,
            "Volver a evaluar la revisión corregida, comprobar la cobertura y comparar la huella del hallazgo. No detectarlo de nuevo no prueba por sí solo su corrección; rotaciones y cambios operativos requieren verificación adicional.");
    }
}
