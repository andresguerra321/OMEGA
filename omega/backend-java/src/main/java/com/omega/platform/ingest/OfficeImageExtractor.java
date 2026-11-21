package com.omega.platform.ingest;

import com.omega.platform.config.OmegaProperties;
import com.omega.platform.integration.forensic.ArchiveSecurityValidator;
import com.omega.platform.ingest.PdfChunkExtractor.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.springframework.stereotype.Component;
import org.w3c.dom.*;
import org.xml.sax.*;

/** Uses installed JDK ZIP/XML, ImageIO and the existing OCR/chunker; no Office execution. */
@Component
public class OfficeImageExtractor {
    private final ArchiveSecurityValidator archives;
    private final OcrExtractor ocr;
    private final PdfChunkExtractor chunker;
    private final OmegaProperties properties;
    public OfficeImageExtractor(ArchiveSecurityValidator archives,OcrExtractor ocr,PdfChunkExtractor chunker,OmegaProperties properties) {
        this.archives=archives; this.ocr=ocr; this.chunker=chunker; this.properties=properties;
    }
    public record Inspection(String format,int pages) {}
    public Inspection inspect(Path path) {
        try (var input=Files.newInputStream(path)) {
            byte[] header=input.readNBytes(8);
            if(header.length>=4 && header[0]=='P' && header[1]=='K') return new Inspection("DOCX",docx(path).size());
            image(path,false);
            return new Inspection("IMAGE",1);
        } catch(InvalidDocumentException ex) { throw ex; }
        catch(Exception ex) { throw new InvalidDocumentException("No se pudo leer el formato del documento."); }
    }
    public ExtractionResult extract(Path path,String format) {
        if("DOCX".equals(format)) {
            List<PageSlice> pages=docx(path);
            return new ExtractionResult(pages.size(),false,chunker.chunkPages(pages));
        }
        String text=PdfChunkExtractor.normalizeText(image(path,true));
        return new ExtractionResult(1,true,chunker.chunkPages(List.of(new PageSlice(1,"Imagen escaneada",text))));
    }
    private String image(Path path,boolean extract) {
        try {
            if(Files.size(path)>properties.ingest().maxImageBytes()) throw new InvalidDocumentException("La imagen supera el tamaño permitido.");
            try(var input=new MemoryCacheImageInputStream(Files.newInputStream(path))) {
                var readers=ImageIO.getImageReaders(input);
                if(!readers.hasNext()) throw new InvalidDocumentException("La imagen no es válida.");
                var reader=readers.next();
                try {
                    reader.setInput(input,true,true);
                    String type=reader.getFormatName().toLowerCase(Locale.ROOT);
                    if(!Set.of("png","jpeg","jpg").contains(type)) throw new InvalidDocumentException("Solo se admiten imágenes PNG o JPEG.");
                    int width=reader.getWidth(0),height=reader.getHeight(0),limit=properties.ingest().maxImageDimension();
                    if(width<=0 || height<=0 || width>limit || height>limit) throw new InvalidDocumentException("La imagen supera las dimensiones permitidas.");
                    if(!extract) return "";
                    var image=reader.read(0);
                    try { return ocr.extractText(image); } finally { image.flush(); }
                } finally { reader.dispose(); }
            }
        } catch(InvalidDocumentException ex) { throw ex; }
        catch(Exception ex) { throw new InvalidDocumentException("No se pudo leer la imagen."); }
    }
    private List<PageSlice> docx(Path path) {
        try {
            byte[] bytes=Files.readAllBytes(path);
            archives.validateArchiveBytes("upload.zip",bytes);
            Document document=null;
            try(var zip=new ZipInputStream(new ByteArrayInputStream(bytes))) {
                ZipEntry entry;
                while((entry=zip.getNextEntry())!=null) {
                    String name=entry.getName().toLowerCase(Locale.ROOT);
                    if(name.contains("vbaproject") || name.startsWith("word/embeddings/") || name.startsWith("word/activex/"))
                        throw new InvalidDocumentException("El archivo Word contiene elementos activos no admitidos.");
                    if(name.equals("word/document.xml") || name.endsWith(".rels")) {
                        byte[] xml=zip.readNBytes(8*1024*1024+1);
                        if(xml.length>8*1024*1024) throw new InvalidDocumentException("El contenido Word supera el límite permitido.");
                        Document parsed=parse(xml);
                        if(name.endsWith(".rels")) {
                            var relationships=parsed.getElementsByTagNameNS("*","Relationship");
                            for(int i=0;i<relationships.getLength();i++)
                                if("External".equalsIgnoreCase(((Element)relationships.item(i)).getAttribute("TargetMode")))
                                    throw new InvalidDocumentException("El archivo Word contiene referencias externas no admitidas.");
                        } else document=parsed;
                    }
                }
            }
            if(document==null) throw new InvalidDocumentException("No es un documento Word compatible.");
            var paragraphs=document.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","p");
            List<PageSlice> pages=new ArrayList<>(); StringBuilder text=new StringBuilder();
            for(int i=0;i<paragraphs.getLength();i++) {
                Element paragraph=(Element)paragraphs.item(i);
                var runs=paragraph.getElementsByTagNameNS("*","t");
                for(int j=0;j<runs.getLength();j++) text.append(runs.item(j).getTextContent()).append(' ');
                text.append('\n');
                var breaks=paragraph.getElementsByTagNameNS("*","br");
                for(int j=0;j<breaks.getLength();j++) {
                    Element br=(Element)breaks.item(j);
                    if("page".equals(br.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","type"))) {
                        addSegment(pages,text); break;
                    }
                }
            }
            if(!text.toString().isBlank() || pages.isEmpty()) addSegment(pages,text);
            return pages;
        } catch(InvalidDocumentException ex) { throw ex; }
        catch(Exception ex) { throw new InvalidDocumentException("No se pudo leer el documento Word de forma segura."); }
    }
    private static void addSegment(List<PageSlice> pages,StringBuilder text) {
        int number=pages.size()+1;
        pages.add(new PageSlice(number,"Segmento Word " + number + " (sin paginación fija)",PdfChunkExtractor.normalizeText(text.toString())));
        text.setLength(0);
    }
    private static Document parse(byte[] bytes) throws Exception {
        var factory=DocumentBuilderFactory.newInstance(); factory.setNamespaceAware(true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD,""); factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
        factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
        var builder=factory.newDocumentBuilder();
        builder.setErrorHandler(new org.xml.sax.helpers.DefaultHandler() {
            @Override public void fatalError(SAXParseException ex) throws SAXException { throw ex; }
            @Override public void error(SAXParseException ex) throws SAXException { throw ex; }
        });
        return builder.parse(new ByteArrayInputStream(bytes));
    }
}
