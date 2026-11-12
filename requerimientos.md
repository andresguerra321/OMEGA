Omega — De Proyecto de Grado a Producto Comercial
Visión de negocio y hoja de ruta de comercialización
Resumen ejecutivo
Omega nació como un proyecto de grado: una plataforma de threat intelligence defensiva sobre spyware comercial, con RAG, verificación forense de IOCs y monitoreo OSINT consentido. Lo que la arquitectura ya construida permite, sin embargo, es algo más grande: un producto real de inteligencia de amenazas personal y organizacional, dirigido a un segmento que hoy está mal atendido —periodistas, defensores de derechos humanos, pymes y equipos de seguridad pequeños que no pueden pagar las plataformas de threat intel de nivel empresarial (Recorded Future, Flashpoint, Mandiant Advantage), pero que enfrentan riesgos reales.
Este documento traza cómo llevar Omega de demo académica a producto viable, siendo honesto sobre los riesgos legales, éticos y de sostenibilidad que una versión comercial introduce y que una versión académica puede ignorar.
El problema de mercado
Existe una brecha clara entre dos extremos:
• Arriba: plataformas de threat intelligence de nivel empresarial, con contratos de decenas de miles de dólares al año, diseñadas para SOCs corporativos grandes.
• Abajo: herramientas gratuitas y dispersas (MVT, bases de datos públicas, foros) que requieren conocimiento técnico avanzado para usarse, sin una interfaz unificada.
En medio quedan periodistas de investigación, ONGs de derechos humanos, pymes y profesionales independientes de alto riesgo que no tienen presupuesto empresarial ni tiempo para aprender herramientas forenses crudas. Omega puede posicionarse exactamente ahí.
Propuesta de valor
"Inteligencia de amenazas de spyware comercial, con verificación forense y monitoreo de exposición, en una interfaz que no requiere ser analista de seguridad para usarla." La diferenciación no es la tecnología RAG en sí —eso ya es commodity— sino la combinación de tres capas (exposición, prevención previa, verificación posterior) en un solo producto accesible.
Segmentos de clientes
1.  Individuos de alto riesgo (B2C freemium): periodistas independientes, activistas, abogados de derechos humanos. Sensibilidad alta al precio; capacidad de pago baja o nula.
2.  Organizaciones de la sociedad civil (B2B institucional): ONGs de derechos humanos, medios de comunicación, sindicatos. Pueden pagar licencias institucionales, a menudo vía financiamiento de fundaciones (Ford Foundation, Open Society, etc., que ya financian herramientas de protección digital).
3.  Equipos de seguridad de pymes (B2B SaaS): empresas que no pueden costear una plataforma de threat intel empresarial pero quieren monitoreo básico de exposición y verificación de IOCs.
4.  Instituciones académicas y de investigación: licencias educativas para enseñanza de CTI.
Modelo de negocio propuesto
• Freemium individual: chat RAG con límite de consultas mensuales y un activo OSINT monitoreado, gratis. Verificación MVT y el verificador de enlaces/SMS, limitados en frecuencia.
• Plan Pro individual (pago): consultas ilimitadas, múltiples activos OSINT, historial completo, exportación de reportes.
• Plan Institucional (licenciamiento): multiusuario, panel de administración, soporte priorizado, posible despliegue on-premise para organizaciones con requisitos estrictos de datos.
• Programas de acceso subsidiado: licencias gratuitas o de bajo costo para ONGs de derechos humanos verificadas, financiadas por el margen de los planes institucionales/corporativos —modelo similar al de Access Now o Citizen Lab con sus propias herramientas de asistencia.
Panorama competitivo (alto nivel)
No compites directamente con Recorded Future o Mandiant (mercado enterprise, precio inalcanzable para tu segmento). Tu competencia real es la fragmentación: hoy, el usuario objetivo usa MVT por un lado, busca reportes manualmente por otro, y no tiene monitoreo de exposición accesible en ningún lado. Omega compite contra "no usar nada" o "usar tres herramientas separadas", no contra un jugador establecido.
Consideraciones legales y éticas para la versión comercial
Esto es lo que una demo académica puede pasar por alto, pero un producto real no:
• Protección de datos personales (Colombia: Ley 1581 de 2012; si hay usuarios internacionales, GDPR aplica igual). Vas a almacenar correos institucionales, dominios y resultados de verificaciones — eso es tratamiento de datos personales con obligaciones reales de consentimiento, finalidad y seguridad, no solo un CHECK en la base de datos.
• Responsabilidad por falsos negativos. Si Omega le dice a un periodista "no se encontró exposición" y luego es comprometido, ¿qué responsabilidad legal/reputacional asumes? Un término de servicio claro que delimite qué garantiza el sistema y qué no es indispensable antes de cobrar por esto.
• Dependencia de terceros (Groq, XposedOrNot, etc.). Un modelo de negocio no puede depender de APIs gratuitas o de terceros que pueden cambiar sus términos o desaparecer; hay que presupuestar esos costos a escala real.
• Seguridad del propio sistema. El hallazgo de autenticación débil que ya identificamos en el código actual no es aceptable en una versión comercial: si tu producto almacena quién ha sido comprometido o qué activos vigila, una brecha en Omega mismo sería catastrófica para la confianza del producto.
Hoja de ruta sugerida (de TFG a V1 comercial)
1.  Fase actual (académica): completar el MVP ya definido, con autenticación real resuelta antes de cualquier intención comercial.
2.  Fase de validación: conversar con 10-15 potenciales usuarios reales (periodistas, ONGs locales) para validar si pagarían o si necesitan el modelo subsidiado.
3.  Fase de app de escritorio (Tauri): la versión distribuible que ya estás construyendo.
4.  Fase de multiusuario real: roles, organizaciones, facturación.
5.  Fase de alianzas institucionales: acercarse a ONGs de protección a periodistas/activistas (CPJ, Access Now, Fundación para la Libertad de Prensa en Colombia) como posibles socios de distribución o financiamiento del tier subsidiado.
Riesgos principales a monitorear
• Mantenimiento del corpus: sin el agente de monitoreo automático que planeaste, el valor del producto se degrada rápido.
• Costo de inferencia a escala: Groq es económico hoy, pero el modelo de negocio debe sobrevivir si eso cambia.
• Percepción de falsa seguridad: el mayor riesgo reputacional no es técnico, es que un usuario crea que Omega lo protege más de lo que realmente puede (ligado al RNF9 ya definido).
Próximos pasos inmediatos
• Resolver autenticación real antes de cualquier piloto con usuarios externos.
• Definir un término de servicio claro sobre el alcance y los límites del sistema.
• Identificar 2-3 organizaciones locales (Colombia) que puedan servir como primeros usuarios piloto.