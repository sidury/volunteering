"""Run: python3 -m unittest discover -s tests"""
import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import vol_api  # noqa: E402

OK = {"Host": "localhost:18081", "X-VOL-Request": "1"}
ENTRY = {"date": "2026-11-01", "organization": "Food Pantry", "activity": "Sorting", "hours": 2.5}
OPP = {"organization": "Shelter", "title": "Dog walking", "cause": "Animals", "date": "2030-05-01"}
CSV = (b"organization,title,cause,date,start,end,location,distance_miles,min_age,max_age,details\n"
       b"Library,Book sale,Education,2030-03-01,09:00,12:00,Main St,2.5,14,,Help set up\n"
       b"Park Trust,Trail day,environment,2030-04-01,,,,,,,\n"
       b"Bad Org,No date,Other,someday,,,,,,,\n")


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = vol_api.make_server(0)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["VOL_DATA_DIR"] = self.tmp.name

    def tearDown(self):
        self.tmp.cleanup()
        os.environ.pop("VOL_DATA_DIR", None)

    def call(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        hdrs = dict(OK if headers is None else headers)
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            hdrs["Content-Type"] = "application/json"
        conn.putrequest(method, path, skip_host="Host" in hdrs)
        for k, v in hdrs.items():
            conn.putheader(k, v)
        if data is not None:
            conn.putheader("Content-Length", str(len(data)))
        conn.endheaders(data)
        r = conn.getresponse()
        parsed = json.loads(r.read() or b"null")
        heads = dict(r.getheaders())
        conn.close()
        return r.status, parsed, heads

    def entry(self, **over):
        status, body, _ = self.call("POST", "/entries", {**ENTRY, **over})
        self.assertEqual(status, 200, body)
        return body

    def opp(self, **over):
        status, body, _ = self.call("POST", "/opportunities", {**OPP, **over})
        self.assertEqual(status, 200, body)
        return body

    def status(self, entry_id, **body):
        return self.call("POST", f"/entries/{entry_id}/status", body)

    # ---- protections
    def test_foreign_host_blocked(self):
        self.assertEqual(self.call("GET", "/entries", headers={"Host": "evil.example:18081"})[0], 403)

    def test_write_needs_header(self):
        self.assertEqual(self.call("POST", "/entries", ENTRY, headers={"Host": "localhost:18081"})[0], 403)
        self.assertEqual(self.call("GET", "/entries")[1], [])

    def test_cross_origin_blocked(self):
        evil = {**OK, "Origin": "https://evil.example"}
        self.assertEqual(self.call("GET", "/entries", headers=evil)[0], 403)
        self.assertEqual(self.call("POST", "/entries", ENTRY, headers=evil)[0], 403)
        self.assertEqual(self.call("GET", "/entries", headers={**OK, "Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_same_origin_allowed(self):
        h = {**OK, "Origin": "http://localhost:18081", "Sec-Fetch-Site": "same-origin"}
        self.assertEqual(self.call("GET", "/entries", headers=h)[0], 200)

    def test_no_cors_and_preflight_refused(self):
        status, _, heads = self.call("OPTIONS", "/entries", headers={"Host": "localhost:18081", "Origin": "https://evil.example"})
        self.assertEqual(status, 405)
        self.assertFalse([k for k in heads if k.lower().startswith("access-control")])

    def test_loopback_only(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_malformed_requests(self):
        hdrs = {**OK, "Content-Type": "application/json"}
        self.assertEqual(self.call("POST", "/entries", headers=hdrs, raw=b"{bad")[0], 400)
        self.assertEqual(self.call("POST", "/entries", headers=hdrs, raw=b"[1]")[0], 400)
        self.assertEqual(self.call("POST", "/entries", headers={**OK, "Content-Type": "text/plain"}, raw=b"{}")[0], 415)
        self.assertEqual(self.call("POST", "/entries", headers=hdrs, raw=b"x" * 70000)[0], 413)
        self.assertEqual(self.call("GET", "/../../etc/passwd")[0], 404)

    # ---- hours log
    def test_entry_status_flow(self):
        e = self.entry()
        self.assertEqual(e["status"], "draft")
        self.assertEqual(self.status(e["id"], status="submitted")[1]["status"], "submitted")
        self.assertEqual(self.status(e["id"], status="verified")[0], 400)
        done = self.status(e["id"], status="verified", verifiedBy="Ms. Rivera")[1]
        self.assertEqual(done["verifiedBy"], "Ms. Rivera")
        self.assertIsNotNone(done["verifiedAt"])
        back = self.status(e["id"], status="draft", verifiedBy="ignored")[1]
        self.assertIsNone(back["verifiedBy"])
        self.assertIsNone(back["verifiedAt"])

    def test_verified_entries_are_locked(self):
        e = self.entry()
        self.status(e["id"], status="verified", verifiedBy="Ms. Rivera")
        self.assertEqual(self.call("PATCH", f"/entries/{e['id']}", {**ENTRY, "hours": 8})[0], 409)

    def test_bad_entries(self):
        for over in ({"hours": 0}, {"hours": 25}, {"hours": 1.1}, {"hours": "two"}, {"date": "tomorrow"},
                     {"date": "2026-13-45"}, {"date": "2090-01-01"}, {"organization": ""}, {"activity": "x" * 201},
                     {"organization": "bad\x00name"}):
            self.assertEqual(self.call("POST", "/entries", {**ENTRY, **over})[0], 400, over)

    def test_delete_needs_confirmation(self):
        e = self.entry()
        self.assertEqual(self.call("DELETE", f"/entries/{e['id']}", {})[0], 409)
        self.assertEqual(len(self.call("GET", "/entries")[1]), 1)
        self.assertEqual(self.call("DELETE", f"/entries/{e['id']}", {"confirmed": True})[0], 200)
        self.assertEqual(self.call("GET", "/entries")[1], [])
        self.assertEqual(self.call("DELETE", f"/entries/{e['id']}", {"confirmed": True})[0], 404)

    # ---- opportunities
    def test_opportunity_rules(self):
        o = self.opp(start="09:00", end="11:00", distanceMiles=3, minAge=14, url="ignored")
        self.assertEqual(o["source"], "student")
        self.assertNotIn("url", o)
        self.assertTrue(self.call("POST", f"/opportunities/{o['id']}/going", {"going": True})[1]["going"])
        edited = self.call("PATCH", f"/opportunities/{o['id']}", {**OPP, "title": "Dog care"})[1]
        self.assertEqual(edited["title"], "Dog care")
        self.assertTrue(edited["going"])

    def test_bad_opportunities(self):
        for over in ({"cause": "Nope"}, {"date": "soon"}, {"start": "25:00"}, {"start": "12:00", "end": "11:00"},
                     {"distanceMiles": -1}, {"minAge": 1.5}, {"minAge": 18, "maxAge": 14}, {"title": ""}):
            self.assertEqual(self.call("POST", "/opportunities", {**OPP, **over})[0], 400, over)

    def upload(self, data, confirm=False):
        return self.call("POST", f"/opportunities/import{'?confirm=1' if confirm else ''}",
                         headers={**OK, "Content-Type": "text/csv"}, raw=data)

    def test_import_previews_then_adds_once(self):
        preview = self.upload(CSV)[1]
        self.assertTrue(preview["preview"])
        self.assertEqual(len(preview["new"]), 2)
        self.assertEqual(preview["errors"][0]["row"], 4)
        self.assertEqual(self.call("GET", "/opportunities")[1], [])
        added = self.upload(CSV, confirm=True)[1]
        self.assertEqual(len(added["new"]), 2)
        rows = self.call("GET", "/opportunities")[1]
        self.assertEqual({o["source"] for o in rows}, {"school"})
        self.assertEqual(rows[1]["cause"], "Environment")
        self.assertEqual(rows[0]["distanceMiles"], 2.5)
        again = self.upload(CSV, confirm=True)[1]
        self.assertEqual((len(again["new"]), again["skippedDuplicates"]), (0, 2))

    def test_school_items_cannot_be_edited_but_can_be_removed(self):
        self.upload(CSV, confirm=True)
        o = self.call("GET", "/opportunities")[1][0]
        self.assertEqual(self.call("PATCH", f"/opportunities/{o['id']}", OPP)[0], 409)
        self.assertEqual(self.call("DELETE", f"/opportunities/{o['id']}", {"confirmed": True})[0], 200)

    def test_bad_imports(self):
        self.assertEqual(self.upload(b"name,when\nA,B\n")[0], 400)
        self.assertEqual(self.upload(b"\xff\xfe\x00bad")[0], 400)
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.putrequest("POST", "/opportunities/import", skip_host=True)
        for k, v in {**OK, "Content-Length": str(vol_api.MAX_CSV_BYTES + 1)}.items():
            conn.putheader(k, v)
        conn.endheaders()  # the server refuses on the declared size, before any body arrives
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()
        many = b"organization,title,date\n" + b"".join(b"A,%d,2030-01-01\n" % i for i in range(501))
        self.assertEqual(self.upload(many)[0], 400)

    # ---- dashboard
    def test_empty_overview(self):
        status, data, _ = self.call("GET", "/overview?today=2026-11-09")
        self.assertEqual(status, 200)
        self.assertEqual(data["hours"]["counted"], 0)
        self.assertIsNone(data["goal"])
        self.assertIsNone(data["nextShift"])

    def test_overview_counts_and_progress(self):
        self.call("PUT", "/goal", {"hours": 10, "label": "This year", "deadline": "2027-06-01"})
        a, b, _ = self.entry(hours=4), self.entry(hours=1), self.entry(hours=0.5)
        self.status(a["id"], status="verified", verifiedBy="Ms. Rivera")
        self.status(b["id"], status="submitted")
        d = self.call("GET", "/overview?today=2026-11-09")[1]
        self.assertEqual(d["hours"], {"draft": 0.5, "submitted": 1.0, "verified": 4.0, "counted": 5.0})
        self.assertEqual(d["progress"], {"percent": 50, "verifiedPercent": 40, "remaining": 5.0})
        self.assertEqual([e["id"] for e in d["awaitingSignoff"]], [b["id"]])
        self.assertEqual(len(d["drafts"]), 1)

    def test_next_shift_is_soonest_upcoming_going(self):
        past = self.opp(title="Past", date="2026-01-01")
        far = self.opp(title="Far", date="2030-06-01")
        near = self.opp(title="Near", date="2030-02-01")
        self.opp(title="Not going", date="2029-01-01")
        for o in (past, far, near):
            self.call("POST", f"/opportunities/{o['id']}/going", {"going": True})
        self.assertEqual(self.call("GET", "/overview?today=2026-11-09")[1]["nextShift"]["title"], "Near")

    def test_goal_validation_and_bad_today(self):
        self.assertEqual(self.call("PUT", "/goal", {"hours": 0})[0], 400)
        self.assertEqual(self.call("PUT", "/goal", {"hours": 5, "deadline": "soon"})[0], 400)
        self.assertEqual(self.call("GET", "/overview?today=nope")[0], 400)

    def test_corrupt_file_reports_and_is_not_overwritten(self):
        path = Path(self.tmp.name) / "entries.json"
        path.write_text("{bad")
        status, body, _ = self.call("GET", "/entries")
        self.assertEqual(status, 500)
        self.assertNotIn(self.tmp.name, json.dumps(body))
        self.assertEqual(path.read_text(), "{bad")


if __name__ == "__main__":
    unittest.main()
