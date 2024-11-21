 public function uploadMgmFile(Request $request)
    {
        $validator = Validator::make($request->all(), [

        if ($validator->fails()) {
            return response()->json(['message' => 'Validation failed. Please check your input.','errors' => $validator->errors()], 422);
        }

        try {
            // Load the file from the request
            $file = $request->file('file');
            $companyId = $request->input('companyId');

            $year = $request->input('year');
            $spreadsheet = IOFactory::load($file->getRealPath());

            // Access the first sheet of the Excel file
            $sheet = $spreadsheet->getActiveSheet();

            // Check specific cells
            $isValidForm = true;
            $errors = [];

            // Validate C1, B2, B3 values
            if ($sheet->getCell('A2')->getValue() !== 'Năm báo cáo') {
                $isValidForm = false;
                $errors[] = "Cell A2 should be 'Năm báo cáo'";
            }
            if ($sheet->getCell('A2')->getValue() !== 'Kỳ báo cáo') {
                $isValidForm = false;
                $errors[] = "Cell A2 should be 'Kỳ báo cáo'";
            }
            if (empty(trim($sheet->getCell('C2')->getValue()))) {
                $errors[] = "Cell C2 should not be empty.";
                $isValidForm = false;
            }
            if (empty(trim($sheet->getCell('C3')->getValue()))) {
                $errors[] = "Cell C3 should not be empty.";
                $isValidForm = false;
            }


            // Expected headers in row 5
            $expectedHeaders = [
                'STT', 'List', 'Chỉ tiêu', 'Code', 'VTG (không gồm cổ tức)', 'VTG gồm cổ tức', 'VTG Net', 'Đ/C nội bộ VTG và TT', 'Đ/C nội bộ các TT', 'Đ/C PB CLTG', 'Đ/C Khác', 'VTC', 'STL', 'NCM', 'MVT', 'VTL', 'VCR', 'VTB', 'VTZ', 'NCM_E','VTP', 'MYN', 'MOV_E','VTL_E','MYN_E','VTC_E','VTB_E','STL_E','VTZ_E'
            ];

            // Validate row 5 headers
            foreach ($expectedHeaders as $column => $header) {
                if($column < 4 || $column >=29) {
                    $cellValue = $sheet->getCellByColumnAndRow($column + 1, 4)->getValue();
                    if ($cellValue !== $header) {
                        $isValidForm = false;
                        $errors[] = "Cell " . chr(65 + $column) . "4 should be '$header'";
                    }
                } else if(  $column >5 && $column <8  ) {
                    $cellValue = $sheet->getCellByColumnAndRow($column + 1, 6)->getValue();
                    if ($cellValue !== $header) {
                        $isValidForm = false;
                        $errors[] = "Cell " . chr(65 + $column) . "6 should be '$header'";
                    }
                } else {
                    $cellValue = $sheet->getCellByColumnAndRow($column + 1, 5)->getValue();
                    if ($cellValue !== $header) {
                        $isValidForm = false;
                        $errors[] = "Cell " . chr(65 + $column) . "5 should be '$header'";
                    }
                }
            }
            if ($sheet->getCell('G5')->getValue() !== 'VTG NET') {
                $isValidForm = false;
                $errors[] = "Cell G4 should be 'VTG NET'";
            }

            $data = [];
            $hasValue = false;


            for ($row = 7; $row <= 487; $row++) {
                for ($col = 'E'; $col <= 'X'; $col++) {
                    $cellValue = $sheet->getCell("{$col}{$row}")->getValue();
                    // Check if at least one cell has a value
                    if (!is_null($cellValue) && trim($cellValue) !== '') {
                        $hasValue = true;
                        if(!is_numeric($cellValue)) {
                            $isValidForm = false;
                            $errors[] = "Cell {$col}{$row} is not number";
                        }
                    }
                }
            }

             // Validate that at least one cell in the range has a value
                ], 400);
            }

            if (!$isValidForm) {
                return response()->json(['message' => 'Excel file format is invalid', 'errors' => $errors], 422);
            };

             // get table khoan muc
            $data_khoan_muc = DB::connection('data_process')->table('khoan_muc')->get();

            // Loop through the specified range of rows (E8 to X457)
            for ($row = 7; $row <= 487; $row++) {
                 // get id khoan mục tương ứng với code của row
                $code_khoan_muc_file = (string) $sheet->getCell("D{$row}")->getValue();
                $item_khoan_muc = $data_khoan_muc->where('code', (string) $code_khoan_muc_file)->first();
                $id_khoan_muc = null;
                if($item_khoan_muc) {
                    $id_khoan_muc = $item_khoan_muc->id;
                }

                // Loop through columns E to X
                for ($col = 'E'; $col <= 'X'; $col++) {
                    $cellValue = $sheet->getCell("{$col}{$row}")->getValue();
                    if (!is_null($cellValue) && trim($cellValue) !== '' && !is_null($code_khoan_muc_file)) {
                        $reportPeriod = null;
                        $periodMonth = null;
                        $periodQuarter = null;

                        // Determine the appropriate report period and period
                        if (in_array($col, range('E', 'P'))) { // Columns E to P
                            $reportPeriod = 1;
                            $periodMonth = ord($col) - ord('E') + 1; // Calculate month number based on column letter
                        } elseif (in_array($col, range('Q', 'T'))) { // Columns Q to T
                            $reportPeriod = 2;
                            $periodQuarter = ord($col) - ord('Q') + 1; // Calculate quarter number based on column letter
                        } elseif ($col == 'U') { // Column U
                            $reportPeriod = 3;
                        } elseif ($col == 'V') { // Column V
                            $reportPeriod = 4;
                        } elseif ($col == 'W') { // Column W
                            $reportPeriod = 5;
                        } elseif ($col == 'X') { // Column X
                            $reportPeriod = 6;
                        }

                        $rowData = (object)['value' =>  $cellValue,
                                            'id_khoan_muc' => $id_khoan_muc,
                                            'report_period' => $reportPeriod,
                                            'period_month' => $periodMonth,
                                            'period_quarter' => $periodQuarter,
                                            'data_type' => 1
                                            ];
                        // Append each row's data to the $data array
                        $data[] = $rowData;
                        // Insert directly into lien_nam table
                        DB::connection('data_process')->table('baocao_nien_nam')->insert([
                                            'value' =>  $cellValue,
                                            'id_khoan_muc' => $id_khoan_muc,
                                            'report_period' => $reportPeriod,
                                            'period_month' => $periodMonth,
                                            'period_quarter' => $periodQuarter,
                                            'data_type' => 1,
                                            'year' => $year,
                                            'id_company' => $companyId,
                                            ]);
                    }
                }
            }
            return response()->json(['data' => $data, 'message' => 'Import success'], 200);
        } catch (\Exception $e) {
            return response()->json(['message' => 'There was an error processing the file.'], 500);
        }
        }
    }
