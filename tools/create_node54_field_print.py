from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageBreak, Paragraph, Spacer, Table, TableStyle,
    KeepTogether, Flowable,
)


OUT = Path("output/pdf/node54_p0002_field_troubleshooting_print.pdf")


class RouteDiagram(Flowable):
    def __init__(self, width=7.35 * inch, height=4.5 * inch):
        super().__init__()
        self.width = width
        self.height = height

    def draw_box(self, c, x, y, w, h, title, subtitle, fill, note=None):
        c.setFillColor(fill)
        c.roundRect(x, y, w, h, 8, fill=1, stroke=0)
        c.setStrokeColor(colors.HexColor("#334155"))
        c.roundRect(x, y, w, h, 8, fill=0, stroke=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(x + w / 2, y + h - 16, title)
        c.setFont("Helvetica", 7)
        c.drawCentredString(x + w / 2, y + h - 29, subtitle)
        if note:
            c.setFillColor(colors.HexColor("#fef3c7"))
            c.setFont("Helvetica-Bold", 6.5)
            c.drawCentredString(x + w / 2, y + 5, note)

    def arrow(self, c, x1, y1, x2, y2, label, color):
        c.setStrokeColor(color)
        c.setFillColor(color)
        c.setLineWidth(2.2)
        c.line(x1, y1, x2, y2)
        ang = 0.55
        if x2 >= x1:
            c.line(x2, y2, x2 - 8, y2 + 4)
            c.line(x2, y2, x2 - 8, y2 - 4)
        else:
            c.line(x2, y2, x2 + 8, y2 + 4)
            c.line(x2, y2, x2 + 8, y2 - 4)
        c.setFont("Helvetica-Bold", 7)
        c.setFillColor(colors.HexColor("#0f172a"))
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 5, label)

    def draw(self):
        c = self.canv
        c.setFillColor(colors.HexColor("#f8fafc"))
        c.roundRect(0, 0, self.width, self.height, 10, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#475569"))
        c.setFont("Helvetica", 7)
        c.drawString(12, self.height - 13, "Engineering relationship from the staking KMZ. Diagram is schematic only; it is not a surveyed route.")

        # coordinates in points relative to the diagram
        self.draw_box(c, 14, 184, 96, 42, "NP2015", "P0002 1x8 source", colors.HexColor("#0f766e"))
        self.draw_box(c, 176, 184, 114, 42, "CP13817 / NP1702", "breakout enclosure", colors.HexColor("#1d4ed8"), "START HERE")
        self.draw_box(c, 414, 258, 103, 42, "NP12001", "S3 first PCOT", colors.HexColor("#0369a1"))
        self.draw_box(c, 414, 184, 103, 42, "NP2058", "S4 first PCOT", colors.HexColor("#b45309"))
        self.draw_box(c, 414, 110, 103, 42, "NP2056", "S5 first PCOT", colors.HexColor("#be123c"))
        self.draw_box(c, 176, 46, 110, 42, "NP1696", "S6 distribution", colors.HexColor("#6d28d9"))
        self.draw_box(c, 414, 46, 103, 42, "NP1697", "S6:T3 point", colors.HexColor("#6d28d9"))

        self.arrow(c, 110, 205, 176, 205, "P0002", colors.HexColor("#0f766e"))
        self.arrow(c, 290, 205, 414, 279, "S3 / F35", colors.HexColor("#0369a1"))
        self.arrow(c, 290, 205, 414, 205, "S4 / F36", colors.HexColor("#b45309"))
        self.arrow(c, 290, 205, 414, 131, "S5 / F37", colors.HexColor("#be123c"))
        self.arrow(c, 100, 184, 176, 67, "S6 / F38", colors.HexColor("#6d28d9"))
        self.arrow(c, 286, 67, 414, 67, "S6:T3 / F43", colors.HexColor("#6d28d9"))
        self.arrow(c, 233, 184, 233, 88, "S6:T2 / F42 control", colors.HexColor("#16a34a"))

        c.setFillColor(colors.HexColor("#166534"))
        c.setFont("Helvetica-Bold", 7)
        c.drawString(300, 94, "F42 terminates at CP13817: useful control, not proof of S3/S4/S5.")
        c.setFillColor(colors.HexColor("#92400e"))
        c.setFont("Helvetica-Bold", 6.5)
        c.drawRightString(self.width - 12, 20, "At each PCOT: identify the physical incoming and outgoing ports before comparing readings.")


def make_styles():
    styles = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("title", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.HexColor("#0f172a"), spaceAfter=5),
        "sub": ParagraphStyle("sub", parent=styles["Normal"], fontSize=9.5, leading=13, textColor=colors.HexColor("#475569"), spaceAfter=12),
        "h": ParagraphStyle("h", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=15, textColor=colors.HexColor("#0f3b63"), spaceBefore=5, spaceAfter=6),
        "body": ParagraphStyle("body", parent=styles["BodyText"], fontSize=8.6, leading=11.6, textColor=colors.HexColor("#172033"), spaceAfter=5),
        "small": ParagraphStyle("small", parent=styles["BodyText"], fontSize=7.3, leading=9.2, textColor=colors.HexColor("#334155")),
        "note": ParagraphStyle("note", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.2, leading=10.5, textColor=colors.HexColor("#7c2d12")),
        "cell": ParagraphStyle("cell", parent=styles["BodyText"], fontSize=7.4, leading=9.2),
        "cellbold": ParagraphStyle("cellbold", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=7.4, leading=9.2),
    }


def p(text, style):
    return Paragraph(text, style)


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(colors.HexColor("#0f3b63"))
    canvas.rect(0, h - 0.32 * inch, w, 0.32 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(0.55 * inch, h - 0.21 * inch, "SPECCOM - NODE 54 / P0002 FIELD TROUBLESHOOTING PRINT")
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.setFont("Helvetica", 7)
    canvas.drawRightString(w - 0.55 * inch, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_pdf():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    doc = BaseDocTemplate(str(OUT), pagesize=letter, rightMargin=0.55 * inch, leftMargin=0.55 * inch, topMargin=0.55 * inch, bottomMargin=0.55 * inch)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")
    doc.addPageTemplates([__import__("reportlab.platypus").platypus.PageTemplate(id="field", frames=[frame], onPage=header_footer)])

    story = []
    story.extend([
        p("Node 54 / P0002 Field Troubleshooting Print", styles["title"]),
        p("Ruidoso Revisit - field sequence built from the project staking KMZ and the Node 54 diagnostic model. Use this as a test plan, not as an as-built or authority to change plant.", styles["sub"]),
        p("IMPORTANT: The amber notes below are field hypotheses. A poor reading does not prove a splice is bad until the same identified fiber is checked immediately before and after the suspected interval with clean test setup.", styles["note"]),
        Spacer(1, 8),
        RouteDiagram(),
        Spacer(1, 8),
        p("Start point and control", styles["h"]),
        p("Start at CP13817 / NP1702. The model puts the S3/F35, S4/F36, and S5/F37 breakouts here. First verify S6:T2/F42, whose historical meter-photo control is -20.71 dBm. That control only supports the F42 path; it does not clear the three adjacent branch fibers.", styles["body"]),
    ])
    story.append(PageBreak())

    story.extend([
        p("Route Stops and What Each Result Tells You", styles["title"]),
        p("Coordinates are from the engineering staking KMZ. Enter them in the app/map; do not substitute a nearby network point merely because it has a similar number.", styles["sub"]),
    ])
    rows = [[p("Stop", styles["cellbold"]), p("Staking point / coordinates", styles["cellbold"]), p("Test path", styles["cellbold"]), p("Field hypothesis / next check", styles["cellbold"])]]
    data = [
        ("1", "CP13817 / NP1702\n33.365529, -105.674531", "F42 control; then S3/F35, S4/F36, S5/F37 before and after breakout", "If F42 is good but one of S3-S5 falls across the breakout, suspect that branch splice, port, or outgoing one-count. If the branch is already weak before breakout, move upstream to NP2015."),
        ("2", "NP2015 - P0002 source\n33.367305, -105.673344", "P0002 input and outputs S3/F35, S4/F36, S5/F37, S6/F38", "Use only when a branch was weak before CP13817 or more than one branch is weak. Compare individual splitter outputs; do not condemn the full feeder from one bad output."),
        ("3", "NP1696 - S6 distribution\n33.366015, -105.673577", "S6/F38 in; T1/F41, T2/F42, T3/F43 out; T4 local", "Separates a shared S6 feed issue from a single T leg. A bad T3 result points downstream only on T3, not on all of S6."),
        ("4", "NP1697 - S6:T3\n33.365876, -105.674514", "S6:T3 / F43", "Historical -31.77 dBm. Reverify this exact T3 path. Treat this as separate from S3-S5 until measurements show a common issue."),
        ("5", "NP2056 / CP11752\n33.364960, -105.674550", "S5:L1 first PCOT", "Historical readings -21.04 and -37.20 dBm, but LOW/HIGH meanings are not defined. Identify actual physical in/out ports and photograph labels before comparison."),
        ("6", "NP2058 / CP12913\n33.364580, -105.673669", "S4:L1 first PCOT", "Historical readings -39.34 and -22.19 dBm. If current incoming is already weak, the likely interval is CP13817 to this PCOT, not the downstream continuation."),
        ("7", "NP12001 / CP12917\n33.364152, -105.673645", "S3:L1 first PCOT", "Historical readings -40.29 and -23.17 dBm. Same rule: identify ports first; then compare true incoming to true continuation."),
    ]
    for stop, loc, path, thought in data:
        rows.append([p(stop, styles["cellbold"]), p(loc.replace("\n", "<br/>"), styles["cell"]), p(path, styles["cell"]), p(thought, styles["cell"])])
    table = Table(rows, colWidths=[0.34 * inch, 1.55 * inch, 1.2 * inch, 3.75 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f3b63")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#94a3b8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
    ]))
    story.append(table)
    story.append(PageBreak())

    story.extend([
        p("At-the-Closure Test Rules", styles["title"]),
        p("Use the same wavelength, meter, launch condition, and identified fiber for every comparison. For the app trace, use 1550 nm. Clean and inspect connectors before accepting a surprise number.", styles["sub"]),
    ])
    rules = [
        ["1. Establish a trustworthy upstream reading", "Measure the known incoming path or source port. A reading around -18 dBm can be normal after prior PON splitting; the important number is the change across the next known interval."],
        ["2. Verify physical identity", "At a PCOT, do not assume LOW means input or HIGH means output. Photograph enclosure and port labels, record the observed port, and follow the identified fiber."],
        ["3. Compare before vs. after", "No splitter expected: a small change is normal. A loss of about 3 dB or more across a splice, closure, or short interval is a red flag and justifies inspecting that interval."],
        ["4. Account for expected splitter loss", "A 1x2 is roughly 3.5-4 dB, 1x4 about 7-8 dB, and 1x8 about 10-11 dB. Do not label expected split loss as a bad splice."],
        ["5. Read the branching pattern", "If a bad event is before a splitter, all child paths should inherit it. If only one child is weak while neighbors are normal, concentrate on that output, its splice, or its downstream span."],
        ["6. Do not let F42 overrule S3-S5", "S6:T2/F42 at CP13817 is a control only. It validates its own path, not the neighboring breakout branches."],
    ]
    rule_rows = [[p(a, styles["cellbold"]), p(b, styles["cell"])] for a, b in rules]
    rule_table = Table(rule_rows, colWidths=[1.9 * inch, 5.0 * inch])
    rule_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e0f2fe")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#94a3b8")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(rule_table)
    story.append(Spacer(1, 12))
    story.append(p("Quick field log - one identified path per row", styles["h"]))
    log_rows = [[p(x, styles["cellbold"]) for x in ["Location / path", "Physical port ID", "In dBm", "Out dBm", "Loss dB", "Expected splitter?", "Photo / note"]]]
    for _ in range(8):
        log_rows.append(["", "", "", "", "", "", ""])
    log = Table(log_rows, colWidths=[1.22 * inch, 1.2 * inch, 0.66 * inch, 0.66 * inch, 0.6 * inch, 0.92 * inch, 1.7 * inch], rowHeights=[0.30 * inch] + [0.43 * inch] * 8, repeatRows=1)
    log.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dbeafe")),
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#64748b")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, 0), 4), ("BOTTOMPADDING", (0, 0), (-1, 0), 4),
    ]))
    story.append(log)
    story.append(Spacer(1, 10))
    story.append(p("Separate issue: 1687 -> 1688 -> 12801 is 1635CA_04 / P0004 and is intentionally outside this P0002 troubleshooting sequence.", styles["note"]))
    story.append(Spacer(1, 8))
    story.append(p("Source basis: Project_NODE54_1635CA.kmz staking data and the Speccom Node 54 P0002 diagnostic configuration. Historical readings are comparison evidence only; LOW/HIGH labels remain undefined.", styles["small"]))
    doc.build(story)


if __name__ == "__main__":
    build_pdf()
    print(OUT)
