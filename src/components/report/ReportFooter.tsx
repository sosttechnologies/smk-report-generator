/** The SMK Gateway letterhead footer. Repeats on every page of the report. */
export function ReportFooter() {
  return (
    <div className="report-footer">
      <div className="report-footer-row">
        <span>
          <span className="report-footer-icon">&#9679;</span>
          Ground Floor, 599 Avebury Boulevard, Milton Keynes MK9 3HR
        </span>
        <span>
          <span className="report-footer-icon">&#9742;</span>
          07908 166 261
        </span>
        <span>
          <span className="report-footer-icon">&#9993;</span>
          info@sievemk.org.uk
        </span>
      </div>
      <div className="report-footer-legal">
        A company limited by guarantee (number 7886477) and a Registered Charity (number 1146451)
      </div>
    </div>
  );
}
