-- Philippine statutory tables. Add a new row with a later effective_from when
-- rates change; the payroll engine picks the row effective on the pay period.

insert into public.statutory_tables (kind, effective_from, effective_to, payload, source) values
('sss', '2023-01-01', '2024-12-31',
 '{"ee_rate":0.045,"er_rate":0.095,"msc_min":4000,"msc_max":30000,"msc_step":500,"ec_threshold":15000,"ec_low":10,"ec_high":30}',
 'SSS Circular 2022-033 (14% contribution rate)'),
('sss', '2025-01-01', null,
 '{"ee_rate":0.05,"er_rate":0.10,"msc_min":5000,"msc_max":35000,"msc_step":500,"ec_threshold":15000,"ec_low":10,"ec_high":30}',
 'SSS Circular 2024-006 (15% contribution rate)'),
('philhealth', '2024-01-01', null,
 '{"rate":0.05,"floor":10000,"ceiling":100000,"ee_share":0.5}',
 'PhilHealth Circular 2020-0005 / UHC Act (5% premium)'),
('pagibig', '2024-02-01', null,
 '{"ee_rate":0.02,"ee_rate_low":0.01,"low_threshold":1500,"er_rate":0.02,"max_fund_salary":10000}',
 'HDMF Circular 460 (₱10,000 maximum fund salary)'),
('wtax_monthly', '2023-01-01', null,
 '{"brackets":[{"over":0,"base":0,"rate":0},{"over":20833,"base":0,"rate":0.15},{"over":33333,"base":1875,"rate":0.20},{"over":66667,"base":8541.80,"rate":0.25},{"over":166667,"base":33541.80,"rate":0.30},{"over":666667,"base":183541.80,"rate":0.35}]}',
 'RR 11-2018 as amended, TRAIN Annex E (2023 onwards)'),
('wtax_annual', '2023-01-01', null,
 '{"brackets":[{"over":0,"base":0,"rate":0},{"over":250000,"base":0,"rate":0.15},{"over":400000,"base":22500,"rate":0.20},{"over":800000,"base":102500,"rate":0.25},{"over":2000000,"base":402500,"rate":0.30},{"over":8000000,"base":2202500,"rate":0.35}],"nontaxable_13th_month_cap":90000,"eight_percent_exempt":250000}',
 'NIRC Sec. 24(A)(2) as amended by TRAIN (2023 onwards)')
on conflict (kind, effective_from) do nothing;
