from pathlib import Path
from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parent
doc = Document()
s = doc.sections[0]
s.page_width, s.page_height = Cm(21), Cm(29.7)
s.top_margin, s.bottom_margin = Cm(2), Cm(1.8)
s.left_margin, s.right_margin = Cm(2.4), Cm(2)
s.footer_distance = Cm(.8)
for name in ['Normal', 'Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Heading 3']:
    st = doc.styles[name]
    st.font.name = 'Times New Roman'
    st.font.color.rgb = RGBColor(0, 0, 0)
    st.font.size = Pt(12)
    fonts = st.element.get_or_add_rPr().rFonts
    for attr in ['asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme']:
        fonts.attrib.pop(qn('w:'+attr), None)
    fonts.set(qn('w:eastAsia'), 'Times New Roman')
    fonts.set(qn('w:cs'), 'Times New Roman')
    for border in st.element.findall('.//'+qn('w:pBdr')):
        border.getparent().remove(border)
    st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.line_spacing = 1.12
doc.styles['Title'].font.size = Pt(23)
doc.styles['Title'].font.bold = True
doc.styles['Heading 1'].font.size = Pt(16)
doc.styles['Heading 2'].font.size = Pt(13)
doc.styles['Heading 3'].font.size = Pt(12)
doc.styles['Normal'].paragraph_format.widow_control = True
footer = s.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
footer.add_run('Nhóm 2 · LOHA PMS | ')
fld = OxmlElement('w:fldSimple'); fld.set(qn('w:instr'), 'PAGE'); footer._p.append(fld)
for r in footer.runs: r.font.size = Pt(9)
md = []
def p(text, style=None):
    doc.add_paragraph(text, style)
    md.append(text+'\n')
def h(text, level=2):
    doc.add_heading(text, level)
    md.append('#'*(level+1)+' '+text+'\n')
def page(title, level=2):
    doc.add_page_break(); h(title, level)
def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers)); t.style='Table Grid'
    t.autofit=False
    if widths:
        for c,w in zip(t.columns,widths): c.width=Cm(w)
    for c,tx in zip(t.rows[0].cells,headers):
        c.text=tx
        sh=OxmlElement('w:shd'); sh.set(qn('w:fill'),'E8EDF2'); c._tc.get_or_add_tcPr().append(sh)
        for r in c.paragraphs[0].runs: r.bold=True
    repeat=OxmlElement('w:tblHeader'); t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in rows:
        cells=t.add_row().cells
        for c,tx in zip(cells,row): c.text=str(tx)
    for row in t.rows:
        pr=row._tr.get_or_add_trPr(); pr.append(OxmlElement('w:cantSplit'))
        for idx,c in enumerate(row.cells):
            if widths: c.width=Cm(widths[idx])
            for pa in c.paragraphs:
                pa.paragraph_format.space_after=Pt(4); pa.paragraph_format.space_before=Pt(3)
                pa.paragraph_format.line_spacing=1.04
                for r in pa.runs: r.font.size=Pt(10.5)
    md.append('| '+' | '.join(headers)+' |\n| '+' | '.join(['---']*len(headers))+' |')
    md.extend('| '+' | '.join(map(str,row)).replace('\n','; ')+' |' for row in rows)
    md.append('')

for text in ['TRƯỜNG ĐẠI HỌC CÔNG NGHỆ KỸ THUẬT TP.HCM', 'LỚP 24LC10SP3']:
    pa=doc.add_paragraph(text); pa.alignment=WD_ALIGN_PARAGRAPH.CENTER
    for r in pa.runs: r.bold=True
doc.add_paragraph('\n')
pa=doc.add_paragraph('BÁO CÁO\nQUẢN LÝ DỰ ÁN PHẦN MỀM','Title'); pa.alignment=WD_ALIGN_PARAGRAPH.CENTER
pa=doc.add_paragraph('Dự án LOHA PMS\nHệ thống quản lý khách sạn','Subtitle'); pa.alignment=WD_ALIGN_PARAGRAPH.CENTER
doc.add_paragraph('')
table(['Thông tin','Nội dung'],[
('Nhóm thực hiện','Nhóm 2'),('Thành viên','Đinh Ý Thức\nLê Trần Xuân Lộc\nLê Hoàng Vinh\nLê Tuấn Phụng'),
('Giảng viên hướng dẫn','........................................................'),
('Ngày bắt đầu dự án','........................................................'),
('Kế hoạch học phần','12 tuần kể từ ngày bắt đầu được thống nhất'),
('Phiên bản tài liệu','1.0 · Ngày lập 05/10/2026')],[4.4,12.2])
p('Nội dung: 4.1 Tài liệu yêu cầu dự án; 4.2 Project Charter; 4.3 Scope Statement; 4.4 WBS chi tiết.')

page('4.1 Tài liệu yêu cầu dự án',1)
h('4.1.1 Tổng quan và vấn đề cần giải quyết')
p('LOHA PMS là ứng dụng web quản lý khách sạn theo mô hình SaaS, cho phép nhiều khách sạn sử dụng chung nền tảng nhưng quản lý dữ liệu độc lập. Dự án có ba khu vực: website giới thiệu sản phẩm, ứng dụng nghiệp vụ khách sạn và trang quản trị hệ thống. Nhóm 2 sử dụng dự án này để xây dựng hồ sơ quản lý dự án và tổ chức hoàn thiện sản phẩm trong phạm vi học phần.')
p('Bài toán đặt ra là tập trung thông tin phòng, khách lưu trú, đặt phòng, dịch vụ, thanh toán và buồng phòng trên cùng hệ thống. Việc quản lý rời rạc có thể làm sai tình trạng phòng, ghi nhận tiền nhiều lần hoặc khó đối chiếu số liệu. Dự án hướng tới quy trình xuyên suốt từ đặt phòng đến trả phòng, có kiểm soát quyền, lịch sử giao dịch và báo cáo phục vụ quản lý.')
h('4.1.2 Mục tiêu sản phẩm')
p('Sản phẩm cần thực hiện được chuỗi đặt phòng → thu cọc → nhận phòng → sử dụng dịch vụ → thanh toán → trả phòng → giao việc dọn → xác nhận sạch. Dữ liệu phải được lưu tại PostgreSQL và đọc lại sau khi tải lại trang. Các báo cáo sử dụng dữ liệu nghiệp vụ có định nghĩa rõ, đồng thời quản trị viên quản lý khách sạn và hai gói Miễn Phí, Chuyên Nghiệp.')
h('4.1.3 Đối tượng sử dụng')
table(['Tác nhân','Nhu cầu và phạm vi quyền'],[
('Quản trị hệ thống','Tạo và quản lý khách sạn; quản lý gói, kỳ hạn và lịch sử đăng ký theo quyền quản trị; khóa/mở khách sạn.'),
('Chủ khách sạn','Quản lý cấu hình, phòng, nhân viên, giá, vận hành và tài chính của khách sạn được cấp quyền.'),
('Lễ tân','Quản lý khách và booking; thu/hoàn theo quyền; theo dõi phòng, giao việc và xác nhận phòng sạch.'),
('Kế toán','Theo dõi sổ quỹ và báo cáo; ghi chứng từ, hoàn/đảo và điều chỉnh tài chính theo quyền.'),
('Nhân viên buồng phòng','Xem công việc được giao, bắt đầu dọn và gửi kiểm tra; không tự xác nhận sạch hoặc truy cập quỹ.'),
('Khách truy cập website','Xem giới thiệu và bảng giá. Không có chức năng tự đặt phòng trực tuyến trong phạm vi học phần.')],[4,12.6])
h('4.1.4 Nền tảng kỹ thuật')
p('Frontend sử dụng React/Vite; backend cung cấp API Flask; dữ liệu lưu bằng PostgreSQL, SQLAlchemy và migration Alembic. Phiên đăng nhập dùng cookie, thao tác thay đổi dữ liệu có CSRF. Dữ liệu khách sạn được kiểm soát qua tenant, membership, quyền API và RLS ở cơ sở dữ liệu. [S1–S3]')

page('4.1.5 Yêu cầu chức năng về vận hành')
p('Mức ưu tiên: M = bắt buộc để nghiệm thu; S = nên có trong phiên bản học phần. Các tiêu chí dưới đây là yêu cầu đích, cần được chứng minh bằng kiểm thử; không thay thế biên bản nghiệm thu.')
table(['Mã','Yêu cầu và ưu tiên','Tiêu chí chấp nhận'],[
('FR01','Xác thực và phân quyền · M','Đăng nhập đúng tạo phiên; đăng xuất/hết hạn mất quyền truy cập. Người dùng không gọi được API ngoài vai trò. Đổi khách sạn chỉ trong membership hợp lệ.'),
('FR02','Khách sạn và nhân viên · M','Quản trị tạo khách sạn và chủ; chủ quản lý membership, vai trò và trạng thái nhân viên. Tenant bị tạm ngưng bị chặn ghi, không sửa dữ liệu tenant khác.'),
('FR03','Danh mục và cấu hình · M','Quản lý loại phòng, phòng, dịch vụ, nguồn đặt phòng, quỹ và phương thức thanh toán. Dữ liệu lưu và tải lại đúng; danh mục có lịch sử được ngừng dùng thay vì làm mất liên kết.'),
('FR04','Giá và phòng trống · M','Thiết lập giá từng ngày, khóa bán và khóa phòng theo khoảng ngày. Báo giá từng đêm đúng; phòng ngừng hoạt động, bảo trì hoặc bị khóa không được bán mới.'),
('FR05','Hồ sơ khách và đặt phòng · M','Tạo, sửa, hủy booking có nhiều phòng và nhiều khách. Ngày đến trước ngày đi. Hai yêu cầu đồng thời không tạo hai booking hoạt động trùng cùng phòng/đêm.'),
('FR06','Nhận và trả phòng · M','Nhận phòng đúng trạng thái/ngày và phòng sạch. Trả phòng chỉ khi số dư bằng 0; chuyển mọi phòng của booking sang bẩn và tạo việc dọn theo quy trình.'),
('FR07','Dịch vụ và thanh toán booking · M','Thêm dịch vụ, phí, thuế, chiết khấu; thu cọc/thanh toán từng phần và hoàn tiền. Tổng/nợ đúng; hoàn không vượt số được hoàn; thử lại cùng giao dịch không ghi tiền hai lần.')],[1.3,5,10.3])
h('Luồng sử dụng chính')
p('Lễ tân chọn ngày và phòng khả dụng, nhập khách, kiểm tra báo giá rồi xác nhận booking. Sau khi thu cọc, lễ tân nhận phòng khi đủ điều kiện. Trong kỳ lưu trú, các khoản dịch vụ được bổ sung vào booking. Khi khách trả phòng, hệ thống kiểm tra số dư, chốt trạng thái, ghi lịch sử và chuyển công việc sang buồng phòng. Chủ khách sạn/kế toán đối chiếu các khoản phát sinh với sổ quỹ.')

page('4.1.6 Yêu cầu chức năng về quản trị và hỗ trợ')
table(['Mã','Yêu cầu và ưu tiên','Tiêu chí chấp nhận'],[
('FR08','POS dịch vụ · S','Lưu/sửa nháp; chốt hóa đơn bán lẻ hoặc ghi vào booking; thu/hoàn và tìm lại hóa đơn. POS ghi vào booking không phát sinh thêm khoản thu trùng.'),
('FR09','Sổ quỹ và thu chi · M','Lập thu/chi/rút/chuyển quỹ, số dư đầu kỳ và đảo chứng từ. Đầu + thu − chi = cuối; chuyển quỹ có hai vế bằng nhau; chi không làm âm quỹ.'),
('FR10','Phân công buồng phòng · M','Quản lý nhân viên/ca trong ngày, giao việc, bắt đầu dọn, gửi kiểm tra và xác nhận sạch. Nhân viên chỉ cập nhật việc của mình; việc cũ không làm sạch phòng của lượt lưu trú mới.'),
('FR11','Dashboard và báo cáo · M','Hiển thị khách/phòng đến, đi, đang ở và các chỉ số theo định nghĩa. Tách tiền phòng dự kiến, doanh thu hóa đơn đã chốt, thực thu, cọc và nợ; lọc theo tenant, kỳ, tiền tệ.'),
('FR12','Hai gói SaaS và gia hạn · M','Chỉ hai định danh FREE/PRO tương ứng Miễn Phí/Chuyên Nghiệp. Quản lý tính năng, quota, trạng thái, hạn và lịch sử. Kiểm tra ở API, kể cả gọi trực tiếp và yêu cầu đồng thời.'),
('FR13','Lịch sử và truy vết · M','Ghi người thao tác, thời điểm và đối tượng cho giao dịch trọng yếu. Tiền đã ghi nhận không bị sửa/xóa trực tiếp; hoàn/đảo tạo bản ghi đối ứng.'),
('FR14','Website giới thiệu · S','Có trang giới thiệu, bảng giá hai gói và thông tin liên hệ; điều hướng sang đăng nhập. Các trang thông tin không được diễn giải thành luồng đặt phòng hoặc thanh toán tự động.')],[1.3,5,10.3])
h('Định nghĩa số liệu phải thống nhất')
p('Tiền phòng dự kiến lấy giá đêm đã chốt của booking chưa hủy. ADR là tiền phòng của các đêm đã kết thúc chia số đêm phòng tương ứng, không gồm dịch vụ và thuế/phí. Doanh thu hóa đơn đã chốt là chỉ số nghiệp vụ theo ngày chốt/điều chỉnh, không đồng nhất với tiền thu. Thực thu ròng bằng thu booking/POS trừ hoàn trong kỳ. Cọc và công nợ là số dư tại thời điểm báo cáo, phải ghi thời điểm lấy số liệu. Các tổng tiền phải tách theo tiền tệ. [S6]')
p('Phòng còn trạng thái đang ở phải được thể hiện đúng trong vận hành ngay cả khi đã đến ngày trả dự kiến. Công suất vận hành hiện tại và công suất dự kiến theo đêm là hai phép đo khác nhau; không dùng thay thế nhau.')

page('4.1.7 Yêu cầu phi chức năng và dữ liệu')
p('Các ngưỡng hiệu năng, phục hồi và khả dụng dưới đây là mục tiêu kiểm thử đề xuất cho học phần; cần ghi cấu hình máy và bộ dữ liệu khi đánh giá.')
table(['Mã','Yêu cầu','Cách xác nhận'],[
('NFR01','Bảo mật và cách ly dữ liệu','Kiểm tra API và PostgreSQL với hai tenant; không đọc/ghi chéo. Cookie HttpOnly, mật khẩu được hash, CSRF cho mutation; tài khoản runtime không được bypass RLS.'),
('NFR02','Nhất quán và toàn vẹn','Booking và tồn phòng cập nhật nguyên tử. Tiền dùng Decimal; ghi sổ cùng transaction. Thử rollback, đặt trùng, chi đồng thời và gửi lại yêu cầu với cùng Idempotency-Key.'),
('NFR03','Hiệu năng tương tác','Đề xuất p95 ≤ 2 giây cho đọc nghiệp vụ thông thường, ≤ 5 giây cho báo cáo kỳ 31 ngày; 20 phiên đồng thời, 100 phòng và 10.000 booking trên môi trường kiểm thử được mô tả.'),
('NFR04','Khả dụng trong trình diễn','Trong buổi UAT 2 giờ, không có gián đoạn ngoài kế hoạch làm dừng luồng chính; lỗi API có thông báo, trạng thái tải và thao tác thử lại có kiểm soát.'),
('NFR05','Sao lưu và khôi phục','Đề xuất sao lưu hằng ngày trên môi trường demo; RPO ≤ 24 giờ, RTO ≤ 2 giờ. Phục hồi bản sao vào database riêng và kiểm tra số booking, ledger, tài khoản.'),
('NFR06','Dễ sử dụng','Nhãn tiếng Việt rõ, báo lỗi ngay tại thao tác; không báo lưu thành công khi máy chủ thất bại. Các luồng lõi dùng được ở màn hình laptop 1366×768, không che nút xác nhận.'),
('NFR07','Bảo trì và triển khai','Tách frontend/backend, cấu hình theo môi trường, có migration và hướng dẫn chạy. Bản bàn giao build được; bộ kiểm thử yêu cầu đạt, lỗi đã biết được ghi nhận.')],[1.6,4.5,10.5])
h('Các nhóm dữ liệu chính')
p('Dữ liệu nền gồm tài khoản, khách sạn, membership và lịch sử. Dữ liệu vận hành gồm loại phòng, phòng vật lý, giá ngày, khóa phòng, khách, booking và đêm phòng. Dữ liệu tài chính gồm phí/dịch vụ, thanh toán, hoàn tiền, ledger, POS và chứng từ thu chi. Dữ liệu hỗ trợ gồm nhân viên/ca/công việc buồng phòng, gói và đăng ký gói. Các quan hệ nghiệp vụ phải giữ phạm vi tenant và bảo toàn lịch sử giá.')

page('4.1.8 Quy tắc nghiệp vụ và nghiệm thu yêu cầu')
table(['Mã','Quy tắc cần tuân thủ'],[
('BR01','Khoảng lưu trú tính từ ngày đến và không gồm ngày đi. Hai booking có ngày đi/ngày đến liền kề có thể dùng cùng phòng nếu thỏa điều kiện vận hành.'),
('BR02','Giá mỗi đêm được chốt vào booking. Đổi giá danh mục không tự sửa booking cũ; thao tác đổi phòng/ngày phải được kiểm tra lại theo hợp đồng nghiệp vụ.'),
('BR03','Checkout chỉ khi đã thanh toán đủ. Dọn xong chưa đồng nghĩa sạch: phải qua bước kiểm tra và xác nhận của vai trò được phép.'),
('BR04','Thu/hoàn/chuyển/đảo có dấu vết, lý do khi cần và chống ghi trùng. Không sửa/xóa chứng từ đã chốt để che lịch sử.'),
('BR05','Mỗi khách sạn sử dụng tiền tệ cấu hình; báo cáo tách VND/USD và không tự quy đổi. Thuế/phí là dòng nhập rõ, không coi là cơ chế khai thuế tự động.'),
('BR06','Quyền người dùng, trạng thái tenant và quyền theo gói đều được kiểm tra tại API. Giao diện khóa nút không thay thế kiểm soát máy chủ.')],[1.6,15])
h('Kịch bản nghiệm thu xuyên suốt')
p('AT01: Tạo hai phòng sạch và một booking hai phòng/hai khách; kiểm tra giá đêm và tồn phòng. AT02: Thu cọc, nhận phòng, thêm dịch vụ; thử checkout khi còn nợ phải bị chặn. AT03: Thu đủ, checkout; kiểm tra ledger, phòng bẩn và công việc dọn. AT04: Nhân viên dọn gửi kiểm tra, lễ tân xác nhận sạch; tài khoản khác không sửa được công việc không thuộc quyền.')
p('AT05: Thử đồng thời hai booking cùng phòng và hai khoản chi vượt tổng tiền quỹ; chỉ kết quả hợp lệ được ghi. AT06: Gửi lại khoản thu cùng mã; không tăng tiền lần hai. AT07: Đổi tenant và gọi URL trực tiếp; không lộ dữ liệu. AT08: Đối soát POS, sổ quỹ và báo cáo bằng bộ số liệu biết trước. AT09: Đổi/gia hạn gói, tải lại và kiểm tra quyền/quota tại API. AT10: Phục hồi bản sao dữ liệu và chạy lại luồng đọc chính.')
h('Căn cứ và quản lý phiên bản yêu cầu')
p('Phạm vi nghiệp vụ được đối chiếu với tài liệu kiến trúc, hợp đồng API, kế hoạch triển khai và mã nguồn các phân hệ. Kho đã có triển khai BE01–BE09; kho, giá nâng cao và tích hợp OTA được tách sang giai đoạn sau. Các báo cáo kiểm thử cũ chỉ chứng minh phiên bản được kiểm tra tại thời điểm lập; phiên bản bàn giao cần được kiểm thử và nghiệm thu riêng. [S1–S8]')
p('Mỗi yêu cầu dùng mã FR/NFR/BR ổn định. Khi thay đổi, cập nhật nội dung, lý do, phiên bản và liên kết tới gói WBS/test tương ứng; trưởng nhóm tổng hợp để giảng viên/đại diện nghiệm thu xem xét.')

page('4.2 Project Charter',1)
h('4.2.1 Thông tin khởi tạo')
table(['Thuộc tính','Nội dung'],[
('Tên dự án','LOHA PMS – Hệ thống quản lý khách sạn'),
('Đơn vị thực hiện','Nhóm 2 · Lớp 24LC10SP3 · Trường Đại học Công nghệ Kỹ thuật TP.HCM'),
('Bối cảnh','Sử dụng và hoàn thiện dự án hiện có làm đối tượng áp dụng quản lý dự án phần mềm trong học phần.'),
('Thời lượng đề xuất','12 tuần; tuần 1 bắt đầu từ ngày nhóm và giảng viên thống nhất.'),
('Chủ trì đề xuất','Đinh Ý Thức phụ trách điều phối; vai trò cần được nhóm thống nhất.'),
('Bên phê duyệt học thuật','Giảng viên phụ trách học phần; họ tên điền trên trang bìa.'),
('Phiên bản điều lệ','1.0; có hiệu lực làm đường cơ sở sau khi được phê duyệt.')],[4.4,12.2])
h('4.2.2 Mục đích và lợi ích kỳ vọng')
p('Dự án tạo một sản phẩm trình diễn có nghiệp vụ liên kết, giúp nhóm thực hành xác định yêu cầu, lập phạm vi, chia công việc, ước lượng, theo dõi rủi ro và nghiệm thu. Giá trị sản phẩm là giảm nhập dữ liệu rời rạc, kiểm soát phòng và tiền nhất quán, đồng thời hỗ trợ phân quyền và vận hành nhiều khách sạn trên nền tảng dùng chung. Đây là lợi ích kỳ vọng, không phải số liệu hiệu quả đã đo tại khách sạn thực tế.')
h('4.2.3 Mục tiêu đo lường')
p('O1: Cuối tuần 2, hoàn tất và thống nhất PRD, Charter, Scope Statement và WBS. O2: Cuối tuần 7, trình diễn liên tục luồng đặt phòng đến trả phòng, bảo toàn tiền và trạng thái phòng. O3: Cuối tuần 10, hoàn tất tích hợp POS, quỹ, buồng phòng, báo cáo và hai gói SaaS theo phạm vi. O4: Cuối tuần 12, bàn giao mã nguồn, dữ liệu demo, hướng dẫn và kết quả nghiệm thu.')
p('Tiêu chí thành công: 100% yêu cầu M được chứng minh bằng ca nghiệm thu đạt; không còn lỗi nghiêm trọng gây lộ dữ liệu, mất dữ liệu, sai tiền hoặc chặn luồng chính. Yêu cầu S được theo dõi riêng; việc bỏ bớt phải qua quy trình thay đổi phạm vi. Tổng công việc nằm trong 480 giờ-người gồm dự phòng.')
h('4.2.4 Sản phẩm cấp cao')
p('Bộ hồ sơ quản lý dự án; ứng dụng web và API; schema/migration; bộ dữ liệu demo giả lập; bộ kiểm thử và biên bản nghiệm thu; hướng dẫn vận hành, triển khai và khôi phục; bản trình diễn phục vụ báo cáo học phần.')

page('4.2.5 Tổ chức và nguồn lực')
p('Phân công dưới đây là phương án đề xuất. Một người chịu trách nhiệm chính cho mỗi gói; các thành viên phối hợp phân tích, lập trình và kiểm thử để cân bằng khối lượng. Trách nhiệm chính không có nghĩa một người tự thực hiện toàn bộ số giờ của gói.')
table(['Thành viên','Vai trò đề xuất','Trách nhiệm'],[
('Đinh Ý Thức','PM/BA','Điều phối, yêu cầu, phạm vi, tiến độ, rủi ro, hồ sơ và đầu mối nghiệm thu.'),
('Lê Trần Xuân Lộc','Frontend','Giao diện React, biểu mẫu và tích hợp API; trải nghiệm vai trò, lỗi và trạng thái tải.'),
('Lê Hoàng Vinh','Backend/Database','API Flask, dữ liệu PostgreSQL, transaction, quyền, migration và hướng dẫn backend.'),
('Lê Tuấn Phụng','QA/Release','Kế hoạch test, dữ liệu demo, kiểm thử tích hợp, ghi lỗi, bằng chứng và bàn giao.')],[4.1,3.2,9.3])
h('Quyền điều phối và cơ chế phối hợp')
p('Trưởng nhóm đề xuất ưu tiên, phân công và điều chỉnh công việc trong phạm vi đã thống nhất. Các thay đổi làm tăng phạm vi, vượt tổng nguồn lực hoặc dời mốc cuối phải được cả nhóm xem xét và trình giảng viên khi ảnh hưởng yêu cầu học phần. Thành viên không tự công bố nghiệm thu phần việc của mình mà thiếu kiểm tra chéo.')
p('Nhóm họp 30 phút mỗi tuần, cập nhật công việc hoàn thành, giờ đã dùng, công việc còn lại, lỗi chặn và rủi ro. Trao đổi kỹ thuật qua kênh nội bộ nhóm chọn; lưu kết luận vào nhật ký dự án. Mỗi mốc có bản trình diễn và kết quả kiểm thử, do PM tổng hợp và QA xác nhận bằng chứng.')
h('Nguồn lực và ngân sách đề xuất')
table(['Hạng mục','Cách tính','Dự toán'],[
('Năng lực nhóm','4 người × 10 giờ/tuần × 12 tuần','480 giờ-người'),
('Công việc theo WBS','Tổng 26 gói công việc ở mục 4.4','432 giờ-người'),
('Dự phòng nguồn lực','480 − 432; tương đương 10% năng lực','48 giờ-người'),
('Nhân công quy đổi học thuật','432 × 50.000 đồng/giờ','21.600.000 đồng'),
('Dự phòng nhân công quy đổi','48 × 50.000 đồng/giờ','2.400.000 đồng'),
('Chi phí tiền mặt','Chạy local, tận dụng máy cá nhân và công cụ hiện có','0 đồng theo phương án cơ sở')],[4.5,7,5.1])
p('Đơn giá 50.000 đồng/giờ chỉ phục vụ bài tập ước lượng, không phải thù lao hoặc chi thực tế. Tổng nguồn lực quy đổi gồm dự phòng là 24.000.000 đồng. Nếu cần thuê máy chủ/domain, lập đề nghị và cập nhật ngân sách trước khi mua; không tính doanh thu gói SaaS vào ngân sách dự án.')

page('4.2.6 Mốc tiến độ và rủi ro cấp cao')
table(['Mốc','Thời điểm','Kết quả cần có'],[
('M1 – Khởi động','Cuối tuần 1','Thống nhất mục tiêu, vai trò và danh sách bên liên quan.'),
('M2 – Đường cơ sở','Cuối tuần 2','Phê duyệt yêu cầu, phạm vi, WBS và kế hoạch kiểm thử sơ bộ.'),
('M3 – Thiết kế và nền tảng','Cuối tuần 4','Mô hình dữ liệu, API, giao diện chính và môi trường demo sẵn sàng.'),
('M4 – Lõi vận hành','Cuối tuần 7','Luồng booking–thanh toán–checkout đạt kiểm thử tích hợp.'),
('M5 – Tích hợp phạm vi','Cuối tuần 10','POS, quỹ, buồng phòng, báo cáo và gói được tích hợp; sẵn sàng UAT.'),
('M6 – Bàn giao','Cuối tuần 12','Hoàn tất UAT, sửa lỗi bắt buộc, bàn giao tài liệu và trình diễn.')],[4.2,3.3,9.1])
table(['Rủi ro','Mức ban đầu','Ứng phó và chủ trách nhiệm'],[
('R01 · Phạm vi tăng do có nhiều màn hình mở rộng','Cao','PM khóa phạm vi BE01–BE09, quản lý yêu cầu thay đổi; đưa kho/OTA/giá nâng cao vào backlog.'),
('R02 · Sai tiền, trùng phòng hoặc rò tenant','Cao','Backend dùng transaction/khóa/RLS; QA chạy ca âm và đồng thời. Lỗi này chặn nghiệm thu.'),
('R03 · Tài liệu cũ khác mã nguồn','Trung bình','PM/QA đối chiếu phiên bản code và bằng chứng; ghi commit của bản bàn giao, không dùng số test cũ làm bằng chứng mới.'),
('R04 · Thiếu thời gian do lịch học','Cao','PM kiểm tra tải hằng tuần, ưu tiên yêu cầu M, phân phối lại; dùng 48 giờ dự phòng sau khi đánh giá tác động.'),
('R05 · Lỗi triển khai hoặc mất dữ liệu demo','Trung bình','QA chuẩn bị dữ liệu giả, bản sao và diễn tập restore; giữ phương án trình diễn local.'),
('R06 · Số liệu báo cáo dễ hiểu sai','Trung bình','BA/Backend chốt định nghĩa với fixture; tách doanh thu, thực thu, cọc và nợ; QA đối soát chéo.')],[6.2,2.4,8])
h('4.2.7 Giả định, ràng buộc và phê duyệt')
p('Giả định mỗi thành viên dành trung bình 10 giờ/tuần; nhóm được sử dụng mã nguồn hiện có, máy cá nhân và dữ liệu giả lập. Khung 12 tuần là kế hoạch đề xuất; ngày lịch phải điền theo lịch học phần. Việc phân tích và hoàn thiện phần đã có vẫn cần thời gian rà soát, tích hợp và kiểm thử, không được coi là miễn phí.')
p('Điều lệ không xác nhận hệ thống đã vận hành production. Giảng viên đánh giá kết quả học thuật; đại diện người dùng nghiệp vụ có thể do nhóm đóng vai khi chưa có khách sạn tham gia. Chỉ ghi trạng thái “đã phê duyệt” sau khi có xác nhận thực tế.')
table(['Bên xác nhận','Họ tên/chữ ký','Ngày'],[('Đại diện nhóm','................................','................'),('Giảng viên phụ trách','................................','................')],[5.2,7.4,4])

page('4.3 Scope Statement',1)
h('4.3.1 Phạm vi sản phẩm')
p('Phiên bản học phần tập trung vào hệ thống quản lý khách sạn từ BE01 đến BE09: nền tảng nhiều tenant, phòng/giá/booking, tài chính, buồng phòng, báo cáo và quản trị hai gói. Nhóm kế thừa mã hiện có, rà soát và hoàn thiện theo yêu cầu ở mục 4.1, không xây lại toàn bộ nếu phần kế thừa đã phù hợp.')
table(['Trong phạm vi','Ranh giới bàn giao'],[
('Tài khoản và khách sạn','Session, membership, quyền, quản trị khách sạn và nhân viên; không gồm hệ thống nhân sự doanh nghiệp.'),
('Phòng và đặt phòng','Loại phòng/phòng, giá ngày, khóa bán, khách, booking nhiều phòng, nhận/trả; không gồm booking theo giờ hoặc tự đặt phòng công khai.'),
('Tài chính','Cọc, thanh toán, hoàn, POS dịch vụ, phiếu thu/chi/chuyển và đối soát; không tích hợp ngân hàng hoặc thanh toán tự động.'),
('Buồng phòng','Nhân viên, ca trong ngày, kế hoạch/giao việc và kiểm tra sạch; không bao gồm chấm công, lương hay ca qua đêm.'),
('Báo cáo','Vận hành, tiền phòng, doanh thu hóa đơn đã chốt, thực thu, cọc/nợ và sổ quỹ; không phải bộ báo cáo kế toán pháp định.'),
('Quản trị SaaS','Hai gói Miễn Phí/Chuyên Nghiệp, quyền tính năng/quota, hạn và lịch sử; không tự thu tiền thuê bao.'),
('Website và triển khai','Website giới thiệu hiện có; bản chạy local, cấu hình mẫu và hướng dẫn triển khai; triển khai Internet cần kế hoạch riêng được thống nhất.')],[4.7,11.9])
h('4.3.2 Phạm vi công việc quản lý và kỹ thuật')
p('Bao gồm lập bốn tài liệu học phần; rà soát nền tảng hiện có; thiết kế/đối chiếu schema, API và giao diện; hoàn thiện các luồng thuộc phạm vi; kiểm thử quyền, tiền, đồng thời và tích hợp; chuẩn bị dữ liệu demo; diễn tập backup/restore; hướng dẫn sử dụng và báo cáo tổng kết. Theo dõi tiến độ, thay đổi và rủi ro là phần việc của dự án, được tính trong WBS.')
h('4.3.3 Ngoài phạm vi')
p('BE10 kho/mua hàng và tiêu hao tồn từ POS; BE11 giá nâng cao, voucher, khuyến mãi và quy đổi ngoại tệ; BE12 OTA/channel manager, thông báo qua nhà cung cấp và ứng dụng mobile riêng. Không bao gồm hóa đơn điện tử, kết nối cổng thanh toán, di chuyển dữ liệu khách sạn thật, vận hành 24/7, chứng nhận bảo mật, bảo trì dài hạn hoặc chức năng chưa có tiêu chí nghiệm thu được phê duyệt.')

page('4.3.4 Sản phẩm bàn giao và chấp nhận phạm vi')
table(['Mã','Sản phẩm bàn giao','Điều kiện chấp nhận'],[
('D01','Hồ sơ quản lý dự án','Có PRD, Charter, Scope Statement, WBS; mã yêu cầu liên kết công việc và nghiệm thu; nhóm thống nhất phiên bản.'),
('D02','Thiết kế và dữ liệu','Có sơ đồ/diễn giải dữ liệu, hợp đồng API, vai trò và migration; dữ liệu demo không chứa thông tin cá nhân thật.'),
('D03','Ứng dụng LOHA PMS','Các FR bắt buộc chạy bằng API và dữ liệu thật trong database demo; tải lại không mất kết quả; không dùng fixture thay thao tác lưu.'),
('D04','Hồ sơ kiểm thử','Có ca kiểm thử, kết quả, lỗi và bằng chứng cho AT01–AT10, NFR trọng yếu; không còn lỗi nghiêm trọng chặn nghiệm thu.'),
('D05','Gói triển khai và vận hành','Hướng dẫn cấu hình/chạy/migration, dữ liệu demo, backup/restore; thành viên khác dựng và chạy được từ hướng dẫn.'),
('D06','Báo cáo và trình diễn cuối kỳ','Tài liệu hoàn chỉnh, kịch bản demo và biên bản bàn giao; ghi phiên bản nguồn, giới hạn và phần việc còn lại.')],[1.4,5.2,10])
h('Quy trình nghiệm thu')
p('Người thực hiện tự kiểm tra rồi chuyển QA kiểm thử trên database riêng. PM kiểm tra truy vết yêu cầu và sản phẩm; nhóm trình diễn cho giảng viên/đại diện nghiệm thu. Kết quả ghi Đạt, Chưa đạt hoặc Chấp nhận có điều kiện kèm lỗi, người xử lý và hạn. Không chấp nhận có điều kiện cho lỗi sai tiền, mất dữ liệu, rò tenant hoặc không chạy được luồng bắt buộc.')
h('4.3.5 Kiểm soát thay đổi phạm vi')
p('Bước 1: Tạo yêu cầu CR với người đề xuất, lý do, mã FR/WBS bị ảnh hưởng và điều kiện chấp nhận. Bước 2: Nhóm ước lượng thêm/bớt giờ, ảnh hưởng mốc, rủi ro và chi phí. Bước 3: PM tổng hợp; cả nhóm thống nhất và xin ý kiến giảng viên khi ảnh hưởng yêu cầu học phần/mốc cuối. Bước 4: Cập nhật phiên bản PRD, Scope, WBS và lịch trước khi thực hiện. Bước 5: QA cập nhật test và kiểm tra kết quả.')
p('Ví dụ: thêm đồng bộ OTA không được coi là chỉnh sửa nhỏ của màn hình có sẵn. Đây là tích hợp mới, cần thông tin nhà cung cấp, cơ chế đồng bộ, xử lý lỗi và kiểm thử riêng; mặc định đưa sang giai đoạn sau. Sửa lỗi để đáp ứng yêu cầu đã duyệt thuộc gói hiện tại, vẫn phải ghi nhận tác động tiến độ.')
h('Điều kiện đóng dự án')
p('D01–D06 đã được bàn giao; các yêu cầu bắt buộc được nghiệm thu; lỗi/giới hạn còn lại có danh sách và người tiếp nhận; mã nguồn và tài liệu được lưu ở phiên bản xác định. PM tổng hợp mức sử dụng nguồn lực so với 432 giờ kế hoạch và 48 giờ dự phòng, ghi bài học kinh nghiệm rồi đề nghị đóng dự án học phần.')

page('4.4 WBS chi tiết',1)
h('4.4.1 Nguyên tắc phân rã')
p('WBS phân rã theo sản phẩm bàn giao, gồm một cấp dự án, bảy nhánh và 26 gói công việc. Các gói cấp thấp nhất bao phủ toàn bộ phạm vi học phần, không cộng trùng giờ của nhánh cha và gói con. Ước lượng gồm rà soát phần kế thừa, hoàn thiện và tự kiểm tra; nhánh 1.6 dành cho kiểm thử độc lập toàn hệ thống và UAT.')
table(['Mã nhánh','Sản phẩm/nhóm công việc','Gói con','Giờ-người'],[
('1','Dự án LOHA PMS','1.1 đến 1.7','432'),
('1.1','Hồ sơ điều hành dự án','1.1.1–1.1.3','40'),
('1.2','Bộ yêu cầu và phạm vi','1.2.1–1.2.3','40'),
('1.3','Thiết kế và môi trường nền','1.3.1–1.3.3','40'),
('1.4','Nghiệp vụ khách sạn cốt lõi','1.4.1–1.4.6','124'),
('1.5','Nghiệp vụ hỗ trợ và quản trị','1.5.1–1.5.4','92'),
('1.6','Hồ sơ kiểm thử và nghiệm thu','1.6.1–1.6.4','64'),
('1.7','Gói bàn giao cuối kỳ','1.7.1–1.7.3','32')],[2,7.4,4,3.2])
h('4.4.2 Quy ước từ điển WBS')
p('Mỗi gói có đầu ra, điều kiện hoàn tất, người chịu trách nhiệm chính, giờ-người và tiền nhiệm. Ký hiệu T1–T12 là tuần tương đối. “Theo mốc” nghĩa là gói được thực hiện xuyên suốt, không phải tiền nhiệm bắt buộc hoàn thành toàn bộ trước khi gói sau bắt đầu. Các tiền nhiệm thông thường dùng quan hệ kết thúc–bắt đầu, có thể bàn giao theo lát đã được kiểm tra.')
p('Tên viết ngắn trong bảng: Thức = Đinh Ý Thức; Lộc = Lê Trần Xuân Lộc; Vinh = Lê Hoàng Vinh; Phụng = Lê Tuấn Phụng. Giờ ước lượng là tổng công sức của người chủ trì và người phối hợp. Dự phòng 48 giờ được quản lý riêng, không phân bổ như một sản phẩm bàn giao giả.')
h('Cách sử dụng để theo dõi')
p('Mỗi gói tương ứng một mục công việc có trạng thái Chưa bắt đầu, Đang thực hiện, Chờ kiểm tra hoặc Hoàn tất. Chỉ đánh dấu hoàn tất khi đầu ra và điều kiện ghi trong từ điển đã đạt. Báo cáo tuần tổng hợp giờ thực tế, giờ còn lại và bằng chứng, tránh dùng số dòng code hoặc số màn hình có giao diện làm tỷ lệ hoàn thành.')

page('4.4.3 Từ điển WBS về quản lý và thiết kế')
table(['Mã và công việc','Đầu ra và điều kiện hoàn tất','Chủ trì\nGiờ','Tiền nhiệm\nTuần'],[
('1.1.1 Khởi động','Charter, vai trò và danh sách bên liên quan; mục tiêu, ràng buộc, quyền quyết định được nhóm thống nhất.','Thức\n12','Không\nT1'),
('1.1.2 Kế hoạch kiểm soát','Lịch mốc, ngân sách, rủi ro và quy trình CR; tổng WBS và nguồn lực khớp, đủ người phụ trách.','Thức\n12','1.2.3\nT2'),
('1.1.3 Theo dõi và đóng quản lý','Nhật ký họp, tiến độ, CR, rủi ro và tổng kết; các quyết định có dấu vết, hoàn tất báo cáo sử dụng nguồn lực.','Thức\n16','1.1.1; theo mốc\nT1–T12'),
('1.2.1 Khảo sát hiện trạng','Danh sách tác nhân, quy trình và chức năng kế thừa; phân biệt mã hiện có, yêu cầu đích và ngoài phạm vi.','Thức\n12','1.1.1\nT1–T2'),
('1.2.2 Yêu cầu và tiêu chí','PRD chứa FR, NFR, BR và kịch bản AT; mỗi yêu cầu có mức ưu tiên và cách kiểm chứng.','Thức\n16','1.2.1\nT2'),
('1.2.3 Đường cơ sở phạm vi','Scope Statement và WBS; D01–D06 có điều kiện chấp nhận, không thiếu đầu ra hoặc cộng trùng công sức.','Thức\n12','1.2.2\nT2'),
('1.3.1 Thiết kế dữ liệu và API','Mô hình quan hệ, tenant và hợp đồng API; đối chiếu booking, ledger, buồng phòng, gói; xác định migration cần thiết.','Vinh\n12','1.2.3\nT3'),
('1.3.2 Thiết kế trải nghiệm','Luồng và màn hình chính cho từng vai trò; có trạng thái tải/lỗi, quyền truy cập và tiêu chí thao tác.','Lộc\n16','1.2.3\nT3'),
('1.3.3 Môi trường phát triển','Frontend/API/PostgreSQL chạy local; cấu hình mẫu và database test riêng; không đưa bí mật vào gói bàn giao.','Phụng\n12','1.3.1\nT3–T4')],[4,8.1,1.8,2.7])

page('4.4.4 Từ điển WBS về nghiệp vụ cốt lõi')
table(['Mã và công việc','Đầu ra và điều kiện hoàn tất','Chủ trì\nGiờ','Tiền nhiệm\nTuần'],[
('1.4.1 Tài khoản và tenant','Đăng nhập, membership, vai trò và quản trị tenant trên UI/API; ca truy cập trái quyền và tenant A/B bị chặn. Đáp ứng FR01–02.','Vinh\n20','1.3.2, 1.3.3\nT4'),
('1.4.2 Danh mục và cấu hình','Loại phòng/phòng, dịch vụ, nguồn, quỹ và phương thức; lưu/tải lại thật, ngừng dùng không mất lịch sử. Đáp ứng FR03.','Lộc\n16','1.4.1\nT4–T5'),
('1.4.3 Giá và phòng khả dụng','Giá ngày, báo giá, stop-sell và khóa phòng; chặn đặt phòng không hợp lệ, giữ giá snapshot. Đáp ứng FR04.','Vinh\n20','1.4.2\nT5'),
('1.4.4 Khách và booking','CRUD khách/booking nhiều phòng, lịch/sơ đồ, hủy và check-in; đặt đồng thời không trùng phòng, tồn ngày đúng. Đáp ứng FR05 và phần nhận phòng FR06.','Lộc\n24','1.4.3\nT5–T6'),
('1.4.5 Tiền và checkout','Dịch vụ/phụ phí, cọc/thu/hoàn, số dư và checkout; idempotency/rollback đúng, còn nợ bị chặn. Đáp ứng FR07 và phần trả phòng FR06.','Vinh\n24','1.4.4\nT6–T7'),
('1.4.6 Buồng phòng','Nhân viên/ca trong ngày, kế hoạch, giao việc, gửi kiểm tra và xác nhận sạch; checkout tạo việc, người không được giao không cập nhật. Đáp ứng FR10.','Lộc\n20','1.4.5\nT7')],[4,8.1,1.8,2.7])
h('Kiểm soát chất lượng trong nhánh lõi')
p('Gói 1.4.4–1.4.5 cần kiểm tra giao dịch đồng thời, điều kiện biên ngày và việc gửi lại thao tác sau lỗi mạng. Đầu ra không chỉ là API hoặc giao diện riêng lẻ mà là luồng có thể sử dụng và tải lại dữ liệu. Lộc phối hợp phần frontend, Vinh phần server; Phụng chuẩn bị ca kiểm thử độc lập ở nhánh 1.6.')
p('Mốc M4 chỉ đạt khi booking nhiều phòng đi hết chuỗi nghiệp vụ và số dư/phòng được đối chiếu. Nếu một thao tác quan trọng chỉ hiển thị dữ liệu mẫu hoặc báo thành công mà không lưu, gói liên quan vẫn ở trạng thái chưa hoàn tất.')

page('4.4.5 Từ điển WBS về hỗ trợ và quản trị')
table(['Mã và công việc','Đầu ra và điều kiện hoàn tất','Chủ trì\nGiờ','Tiền nhiệm\nTuần'],[
('1.5.1 POS và sổ quỹ','POS nháp/chốt/thu/hoàn và thu/chi/chuyển/đảo; đối soát toàn kỳ đúng, POS vào booking không thu hai lần. Đáp ứng FR08–09.','Vinh\n20','1.4.5\nT8'),
('1.5.2 Dashboard và báo cáo','Số vận hành và tiền theo định nghĩa ở PRD; lọc kỳ/tenant/currency, dữ liệu thật, lỗi tải không hiển thị thành công. Đáp ứng FR11.','Lộc\n20','1.5.1\nT8–T9'),
('1.5.3 Hai gói và lịch sử','FREE/PRO, quota, tính năng, kỳ hạn, cập nhật và lịch sử; kiểm tra API trực tiếp/đồng thời, đọc lại sau gia hạn. Đáp ứng FR12.','Vinh\n24','1.4.4\nT8–T9'),
('1.5.4 Hoàn thiện toàn hệ thống','Tích hợp ba khu vực, kiểm tra audit và trạng thái lỗi/quyền; rà soát website giới thiệu, không đưa chức năng ngoài phạm vi vào nghiệm thu. Đáp ứng FR13–14 và tích hợp.','Lộc\n28','1.4.6, 1.5.2, 1.5.3\nT9–T10')],[4,8.1,1.8,2.7])
h('Phụ thuộc và phương án thực hiện song song')
p('Sau khi có booking ổn định, nhánh hai gói có thể tiến hành song song với POS/báo cáo. POS/sổ quỹ phải cung cấp dữ liệu trước khi đối soát báo cáo. Buồng phòng cần sự kiện checkout và phiên bản trạng thái phòng. Gói hoàn thiện toàn hệ thống chỉ kết thúc khi các phân hệ cung cấp đầu ra phù hợp và xử lý lỗi nhất quán.')
p('Nhóm cần kiểm soát điểm giao giữa frontend, API và dữ liệu: mỗi luồng có hợp đồng chung; thay đổi payload phải cập nhật cả nơi gọi và kiểm thử. Đối với phần mã đã có, gói công việc được hoàn tất bằng rà soát, sửa khi cần và bổ sung bằng chứng, không lập trình lại chỉ để khớp kế hoạch.')
h('Cổng kiểm tra trước UAT')
p('Kết thúc tuần 10, nhóm chốt một bản ứng viên nghiệm thu. Không bổ sung chức năng mở rộng vào bản này khi chưa có CR được duyệt. Các lỗi liên quan quyền, số dư, giao dịch trùng và trạng thái phòng phải được phân loại ưu tiên cao; lỗi trình bày nhỏ được ghi riêng để không che khuất lỗi nghiệp vụ.')

page('4.4.6 Từ điển WBS về kiểm thử và bàn giao')
table(['Mã và công việc','Đầu ra và điều kiện hoàn tất','Chủ trì\nGiờ','Tiền nhiệm\nTuần'],[
('1.6.1 Kế hoạch test và dữ liệu','Bộ ca FR/NFR/BR, dữ liệu giả hai tenant, nhiều vai trò, giá/tiền biết trước; đủ AT01–AT10 và truy vết yêu cầu.','Phụng\n16','1.2.2\nT3–T4'),
('1.6.2 Kiểm thử độc lập','Kết quả API/database/UI, quyền, concurrency và hiệu năng; ghi môi trường, phiên bản, dữ liệu, kết quả mong đợi/thực tế và bằng chứng.','Phụng\n24','1.6.1; nhận từng gói 1.4–1.5\nT5–T10'),
('1.6.3 UAT và hồi quy','Chạy bản tích hợp và AT01–AT10; sửa lỗi/hồi quy với người phụ trách phân hệ; không còn lỗi nghiêm trọng, yêu cầu M đạt.','Phụng\n16','1.5.4, 1.6.2\nT11'),
('1.6.4 Chốt nghiệm thu','Biên bản nghiệm thu, danh sách giới hạn, kết quả NFR và phiên bản bàn giao; được người có trách nhiệm xác nhận.','Thức\n8','1.6.3, 1.7.2\nT12'),
('1.7.1 Gói chạy và dữ liệu demo','Cấu hình mẫu, migration, dữ liệu demo và hướng dẫn dựng; thành viên khác dựng được trên môi trường sạch.','Vinh\n12','1.5.4\nT11'),
('1.7.2 Vận hành và phục hồi','Hướng dẫn vai trò, backup/restore, diễn tập trên database riêng; dữ liệu và luồng đọc sau restore đúng.','Phụng\n12','1.7.1\nT11–T12'),
('1.7.3 Báo cáo và trình diễn','Bộ tài liệu cuối kỳ, kịch bản demo, gói nguồn và biên bản bàn giao; xác định nơi lưu và trách nhiệm tiếp nhận.','Thức\n8','1.6.4, 1.1.3\nT12')],[4,8.1,1.8,2.7])
p('Phân biệt nỗ lực sửa và kiểm thử: tự kiểm tra từng phân hệ nằm trong 1.4/1.5; kiểm thử độc lập nằm trong 1.6.2; vòng sửa lỗi tích hợp cuối và hồi quy nằm trong 1.6.3. Nếu vượt 16 giờ của vòng này, PM phân tích để dùng dự phòng hoặc xin thay đổi, không ghi trùng cùng số giờ ở nhiều gói.')

page('4.4.7 Kế hoạch nguồn lực và truy vết')
table(['Khoảng tuần','Trọng tâm','Giờ dự kiến','Năng lực'],[
('T1–T2','Khởi động, khảo sát, yêu cầu, đường cơ sở và kế hoạch','76','80'),
('T3–T4','Thiết kế, môi trường, test plan, quyền và bắt đầu danh mục','76','80'),
('T5–T7','Giá, booking, thanh toán, buồng phòng; test theo lát','112','120'),
('T8–T10','POS/quỹ, báo cáo, hai gói, tích hợp và test','112','120'),
('T11–T12','UAT, hồi quy, hướng dẫn, restore và bàn giao','56','80'),
('Tổng','432 giờ kế hoạch + 48 giờ dự phòng','432','480')],[3,8,2.8,2.8])
p('Phân bổ sơ bộ theo người thực hiện: Thức 100 giờ, Lộc 112 giờ, Vinh 112 giờ, Phụng 108 giờ; mỗi người có năng lực 120 giờ. Tổng dự phòng tương ứng 20 + 8 + 8 + 12 = 48 giờ. Khi chia việc tuần, Thức hỗ trợ rà soát nghiệp vụ/tài liệu và Phụng hỗ trợ tích hợp, dữ liệu, cấu hình; tránh để mọi gói do Vinh chủ trì đều trở thành giờ của riêng Vinh.')
table(['Yêu cầu/sản phẩm','Gói WBS chính','Bằng chứng'],[
('FR01–02 / D03','1.4.1','Đăng nhập, quyền và cách ly hai tenant'),
('FR03–04 / D02–D03','1.4.2–1.4.3','Danh mục, báo giá, snapshot, khóa bán'),
('FR05–07 / D03','1.4.4–1.4.5','AT01–03, AT05–06'),
('FR08–09 / D03','1.5.1','AT08 và sổ quỹ đối soát'),
('FR10 / D03','1.4.6','AT04 và công việc lỗi thời bị chặn'),
('FR11–12 / D03','1.5.2–1.5.3','AT08–09, quyền/quota tại API'),
('FR13–14 / D03','1.5.4','Audit và website/điều hướng'),
('NFR01–04, NFR06 / D04','1.6.1–1.6.4','Báo cáo kiểm thử, UAT và lỗi'),
('NFR05, NFR07 / D05','1.7.1–1.7.2','Dựng môi trường và AT10'),
('D01, D06','1.1–1.2, 1.7.3','Hồ sơ được thống nhất và bàn giao')],[4.5,4.5,7.6])
p('Lịch này là kế hoạch nguồn lực, không phải đường găng đã tính bằng CPM. Sau khi có ngày bắt đầu và lịch rảnh từng người, nhóm lập lịch chi tiết từ tiền nhiệm và số giờ của các gói; chỉ chốt đường găng khi đã xác định thời lượng và tải nguồn lực thực tế.')

page('Tài liệu dự án và thuật ngữ')
h('Danh mục nguồn nội bộ')
p('Nguồn dùng để xác định sản phẩm và quy tắc nghiệp vụ; truy cập trong kho pms-system ngày 05/10/2026. Các mục tiêu thời gian, nhân lực, ngân sách và ngưỡng nghiệm thu của báo cáo là kế hoạch học phần đề xuất.')
table(['Mã','Tài liệu hoặc vị trí mã nguồn','Nội dung đối chiếu'],[
('S1','README.md; docs/ARCHITECTURE.md','Tên sản phẩm, ba khu vực, cấu trúc frontend/backend.'),
('S2','backend/API_CONTRACT.md','API, quyền, tenant, booking, tiền, POS và buồng phòng.'),
('S3','backend/README.md','Nền tảng kỹ thuật, migration, môi trường và hướng dẫn chạy.'),
('S4','tasks/plan.md; tasks/todo.md','Nhóm công việc BE01–BE12, phạm vi đã có và mở rộng.'),
('S5','BE06_07_IMPLEMENTATION_REPORT.md','POS, thu chi, buồng phòng và giới hạn theo phiên bản báo cáo.'),
('S6','backend/pms_api/reports/routes.py','Định nghĩa báo cáo, tiền phòng, doanh thu, thu ròng, cọc và nợ.'),
('S7','backend/pms_api/admin/routes.py; backend/pms_api/subscriptions.py','Gói, quota, kỳ hạn, lịch sử và kiểm soát quyền tính năng.'),
('S8','frontend/src/shared/components/AccessControl.jsx; frontend/src/apps/manager/billing/pages/AdminBilling.jsx','Giới hạn màn hình tương lai, luồng quản trị gói hiện tại.'),
('S9','BE08_09_TEST_REPORT.md','Kết quả kiểm thử lịch sử; dùng làm đầu vào rủi ro và ca hồi quy, không suy ra mọi lỗi vẫn còn ở mã hiện tại.')],[1.2,9.1,6.3])
h('Thuật ngữ')
table(['Thuật ngữ','Diễn giải'],[
('PMS / SaaS','Phần mềm quản lý khách sạn / cung cấp phần mềm như dịch vụ.'),
('Tenant / Membership','Đơn vị khách sạn tách dữ liệu / quan hệ người dùng và khách sạn.'),
('RLS / Ledger','Bảo vệ dữ liệu theo hàng tại database / sổ ghi giao dịch tiền.'),
('Idempotency','Gửi lại cùng một ý định thao tác không tạo thêm giao dịch trùng.'),
('WBS / UAT','Cấu trúc phân rã công việc / kiểm thử chấp nhận bởi người dùng.'),
('Giờ-người / RPO / RTO','Công sức lao động / mức mất dữ liệu tối đa theo thời gian / thời gian mục tiêu để phục hồi.')],[4.5,12.1])

doc.core_properties.title='Báo cáo quản lý dự án phần mềm LOHA PMS'
doc.core_properties.subject='PRD, Project Charter, Scope Statement và WBS'
doc.core_properties.author='Nhóm 2 – Lớp 24LC10SP3'
doc.core_properties.keywords='LOHA PMS, quản lý dự án phần mềm, nhóm 2'
out=ROOT/'Bao_cao_QLDA_LOHA_PMS_Nhom_2.docx'
doc.save(out)
(ROOT/'Bao_cao_QLDA_LOHA_PMS_Nhom_2.md').write_text('# Báo cáo quản lý dự án phần mềm LOHA PMS\n\n'+'\n'.join(md),encoding='utf-8')
print(out)
print('Document saved')
