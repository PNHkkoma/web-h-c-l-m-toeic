<?php

namespace ProcessMaker\Http\Controllers\Api;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Validator;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Illuminate\Validation\ValidationException;
use Pion\Laravel\ChunkUpload\Exceptions\UploadMissingFileException;
use ProcessMaker\Exceptions\ApiException;
use Exception;
use ProcessMaker\Http\Controllers\Controller;
use ProcessMaker\Models\Department;
use Auth;
use ProcessMaker\Models\Process;
use ProcessMaker\Models\ProcessRequest;
use ProcessMaker\Models\ProcessRequestToken;
use ProcessMaker\Models\User;
use ProcessMaker\Models\GroupMember;
use DB;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Maatwebsite\Excel\Facades\Excel;
use ProcessMaker\Imports\FileImport;



class ComparativeReportController extends Controller
{

    //A vũ viết, lấy
    public function getSampleAdjustDataFile(Request $request)
    {
        // Validate that the request contains a file, parentPath
        $validator = Validator::make($request->all(), [
            'companyName' => 'required',
            'year' => 'required',
            'adjustType' => 'required',
            'lstClause' => 'required',
            'adjustPeriod' => 'required',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation failed. Missing Field.',
                'errors' => $validator->errors(),
            ], 422);
        }

        try {
            $companyName = $request->input('companyName');
            $year = $request->input('year');
            $adjustType = $request->input('adjustType');
            $lstClause = $request->input('lstClause');
            $adjustPeriod = $request->input('adjustPeriod');

            // Attempt to list files in the bucket
            $files = Storage::disk('minio')->allFiles('template-import-adjust');

            if (empty($files)) {
                return response()->json(['message' => 'No files found'], 404);
            }

            $latestFile = collect($files)->sortByDesc(function ($file) {
                return Storage::disk('minio')->lastModified($file);
            })->first();

            // Load the file from MinIO into a stream
            $stream = Storage::disk('minio')->get($latestFile);

            // Temporarily store the file to modify it with PhpSpreadsheet
            $tempFile = tempnam(sys_get_temp_dir(), 'excel');
            file_put_contents($tempFile, $stream);

            // Load the file into PhpSpreadsheet
            $spreadsheet = IOFactory::load($tempFile);

            // Modify cells companyName, year in file
            $sheet = $spreadsheet->getActiveSheet();
            $sheet->setCellValue('C3', $companyName);
            $sheet->setCellValue('C4', $year);
            $sheet->setCellValue('C5', $adjustType);

            // start position fill data
            $startRow = 9;

            foreach ($lstClause as $index => $item) {
                $sheet->setCellValue('A' . ($startRow + $index), $index + 1);
                $sheet->setCellValue('B' . ($startRow + $index), $item['name_eng']);
                $sheet->setCellValue('C' . ($startRow + $index), $item['name_vie']);
                $sheet->setCellValue('D' . ($startRow + $index), $item['code']);
                $sheet->setCellValue('E' . ($startRow + $index), $adjustPeriod);
            }

            // Save the modified spreadsheet to a new temporary file
            $modifiedTempFile = tempnam(sys_get_temp_dir(), 'modified_excel');
            $writer = new Xlsx($spreadsheet);
            $writer->save($modifiedTempFile);

            // Return the modified file as a download response
            return response()->download($modifiedTempFile, 'adjust-data-sample.xlsx')->deleteFileAfterSend(true);
        } catch (Exception $e) {
            // custom error response
            return response()->json(['message' => 'Could not connect to the storage service or process the file'], 500);
        }
    }
    //lấy file mẫu chăng? cái này cần lấy từ minio, học cách kết nối, cái này cần xem lại`
    //cái này dùng để tải file xuống, làm cho chức năng lấy file mẫu, ghép với code của a vũ
    public function getComparaDataFile(Request $request)
    {
        try {
            // Lấy nội dung file từ MinIO
            $fileContent = Storage::disk('minio')->get('Book3.xlsx');

            // Trả về file dưới dạng phản hồi tải xuống
            return response($fileContent, 200)
                ->header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                ->header('Content-Disposition', 'attachment; filename="Book3.xlsx"');
        } catch (\Exception $e) {
            return response()->json(['message' => 'Error connecting to MinIO: ' . $e->getMessage()], 500);
        }
    }
    //hàm upload file, cái này mình đã sửa r, nó khá là thành công, đã biết cách để ghi vào file excel, tùy chỉnh theo yêu cầu BA
    public function uploadMgmFile(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|mimes:xlsx,xls|mimetypes:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel/max:102400',
        ], [
            'file.mimes' => 'The file must be an Excel file with the extension .xlsx or .xls.',
            'file.mimetypes' => 'The file must be a valid Excel file format.',
            'file.max' => 'The file size must not exceed 100MB.',
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => 'Validation failed. Please check your input.', 'errors' => $validator->errors()], 422);
        }

        try {
            // Load the file from the request
            $file = $request->file('file');

            $spreadsheet = IOFactory::load($file->getRealPath());

            // Access the first sheet of the Excel file
            $sheet = $spreadsheet->getActiveSheet();

            // Check specific cells
            $isValidForm = true;
            $errors = [];

            // Validate C1, B2, B3 values
            $ky = $sheet->getCell('C3')->getValue();
            $nam = $sheet->getCell('C2')->getValue();
            if (is_null($nam) || trim($nam) == '') {
                $sheet->setCellValue('C2', 'năm báo cáo không được để trống');
            }
            if (is_null($ky) || trim($ky) == '') {
                // Thay đổi nội dung trong các ô
                $sheet->setCellValue('C3', 'kỳ báo cáo không được để trống');
            }
            if ($sheet->getCell('A2')->getValue() !== 'Năm báo cáo') {
                $isValidForm = false;
                $errors[] = "Cell A2 should be 'Năm báo cáo'";
            }
            if ($sheet->getCell('A3')->getValue() !== 'Kỳ báo cáo') {
                $isValidForm = false;
                $errors[] = "Cell A2 should be 'Kỳ báo cáo'";
            }
            if ($sheet->getCell('A1')->getCalculatedValue() !== "BÁO CÁO KẾ HOẠCH KHÁC KỲ{$ky}năm{$nam}") {
                $isValidForm = false;
                $errors[] = "Cell A1 should be 'BÁO CÁO KẾ HOẠCH KHÁC KỲ{$ky}năm{$nam}'";
            }
            $name_report = DB::table('vtg_list_ke_hoach_khac')->where('report_name', $sheet->getCell('A1')->getValue())->first();
            if ($name_report) {
                $errors[] = "Report name already exists.";
                $isValidForm = false;
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
                'STT',
                'List',
                'Chỉ tiêu',
                'Code',
                'VTG (không gồm cổ tức)',
                'VTG gồm cổ tức',
                'VTG Net',
                'Đ/C nội bộ VTG và TT',
                'Đ/C nội bộ các TT',
                'Đ/C PB CLTG',
                'Đ/C Khác',
                'VTC',
                'STL',
                'NCM',
                'MVT',
                'VTL',
                'VCR',
                'VTB',
                'VTZ',
                'NCM_E',
                'VTP',
                'MYN',
                'MOV_E',
                'VTL_E',
                'MYN_E',
                'VTC_E',
                'VTB_E',
                'STL_E',
                'VTZ_E'
            ];

            // Validate row 5 headers
            foreach ($expectedHeaders as $column => $header) {
                if ($column < 4 || $column >= 29) {
                    $cellValue = $sheet->getCellByColumnAndRow($column + 1, 4)->getValue();
                    if ($cellValue !== $header) {
                        $isValidForm = false;
                        $errors[] = "Cell " . chr(65 + $column) . "4 should be '$header'";
                    }
                } else if ($column > 5 && $column < 8) {
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

            $columns = range('E', 'Z');
            $columns = array_merge($columns, ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH']);

            for ($row = 7; $row <= 74; $row++) {
                foreach ($columns as $col) {
                    $cellValue = $sheet->getCell("{$col}{$row}")->getCalculatedValue();

                    // Check if at least one cell has a value
                    if (!is_null($cellValue) && trim($cellValue) !== '') {
                        if (!is_numeric($cellValue)) {
                            $isValidForm = false;
                            $errors[] = "Cell {$col}{$row} is not a number";
                            $errors[] = $cellValue;
                        }
                    }
                }
            }

            if (!$isValidForm) {
                return response()->json(['message' => 'Excel file format is invalid', 'errors' => $errors], 422);
            };

            // get table khoan muc
            $data_khoan_muc = DB::table('khoan_muc')->get();
            $codes = [
                '1',
                '2',
                '3',
                '4',
                '6',
                '7',
                '85',
                '86',
                '87',
                '88',
                '89',
                '29',
                '30',
                '31',
                '32',
                '33',
                '34',
                '35',
                '36',
                '37',
                '40',
                '41',
                '42',
                '43',
                '44',
                '45',
                '46',
                '47',
                '48',
                '49',
                '50',
                '51',
                '52',
                '53',
                '54',
                '55',
                '56',
                '57',
                '58',
                '59',
                '60',
                '61',
                '62',
                '63',
                '64',
                '65',
                '100',
                '101',
                '102',
                '103',
                '104',
                '105',
                '106',
                '107',
                '108',
                '109',
                '110',
                '111',
                '112',
                '71',
                '72',
                '73',
                '113',
                '80',
                '81',
                '82',
                '83',
                '84'
            ];
            // Loop through the specified range of rows (E8 to X457)
            for ($row = 7; $row <= 74; $row++) {
                // get id khoan mục tương ứng với code của row
                $code_khoan_muc_file = (string) $sheet->getCell("D{$row}")->getValue();
                if ($code_khoan_muc_file != $codes[$row - 7]) {
                    $isValidForm = false;
                    $errors[] = "Cell D{$row} is not {$codes[$row - 7]}";
                }
                if ((string) $sheet->getCell("A{$row}")->getValue() != $row - 6) {
                    $STT = $row - 6;
                    $isValidForm = false;
                    $errors[] = "Cell A{$row} is not {$STT}";
                }
                $item_khoan_muc = $data_khoan_muc->where('code', $code_khoan_muc_file)->first();
                if (!$item_khoan_muc) {
                    break;
                    $isValidForm = false;
                    $errors[] = "No record found with code: $code_khoan_muc_file";
                } else {
                    if ((string) $sheet->getCell("C{$row}")->getValue() != $item_khoan_muc->name_vie) {
                        $isValidForm = false;
                        $errors[] = "Cell C{$row} is not {$item_khoan_muc->name_vie}";
                    }
                    if ((string) $sheet->getCell("B{$row}")->getValue() != $item_khoan_muc->name_eng) {
                        $isValidForm = false;
                        $errors[] = "Cell B{$row} is not {$item_khoan_muc->name_eng}";
                    }
                }
            }
            if (!$isValidForm) {
                return response()->json(['message' => 'Excel file format is invalid', 'errors' => $errors], 422);
            };

            //save minio
            $fileName = $file->getClientOriginalName();
            if (Storage::disk('minio')->exists($fileName)) {
                return response()->json(['message' => 'File already exists'], 409);
            }
            $filePath = Storage::disk('minio')->putFileAs('', $file, $fileName);

            //read and save DB
            $bodyData = $request->except('file');
            Excel::import(new FileImport($bodyData), $request->file('file'));
            // Return the data as a JSON response to the frontend
            return response()->json(['message' => 'Import success'], 200);
        } catch (\Exception $e) {
            return response()->json(['message' => 'There was an error processing the file.'], 500);
        }
    }

    //không biết, cái này a Vũ viết
    public function processFile(Request $request)
    {
        $validator = Validator::make($request->all(), [
            'file' => 'required|file|mimes:xlsx,xls',
        ]);

        if ($validator->fails()) {
            return response()->json(['errors' => $validator->errors()], 422);
        }

        try {
            // Load the file from the request
            $file = $request->file('file');
            $spreadsheet = IOFactory::load($file->getRealPath());

            // Access the first sheet of the Excel file
            $sheet = $spreadsheet->getActiveSheet();
            $data = [];
            $hasValue = false;

            // Loop through the specified range of rows (E8 to X457)
            for ($row = 8; $row <= 457; $row++) {
                $rowData = [];

                // Loop through columns E to X
                for ($col = 'E'; $col <= 'X'; $col++) {
                    $cellValue = $sheet->getCell("{$col}{$row}")->getValue();
                    $rowData[] = $cellValue;

                    // Check if at least one cell has a value
                    if (!is_null($cellValue) && trim($cellValue) !== '') {
                        $hasValue = true;
                    }
                }

                // Append each row's data to the $data array
                $data[] = $rowData;
            }

            // Validate that at least one cell in the range has a value
            if (!$hasValue) {
                return response()->json([
                    'message' => 'The uploaded file does not contain any data in the specified range (E8:X457).',
                ], 400);
            }

            // Return the data as a JSON response to the frontend
            return response()->json(['data' => $data], 200);
        } catch (\Exception $e) {
            return response()->json(['message' => 'There was an error processing the file.'], 500);
        }
    }

    public function getClauseList()
    {
        try {
            $data = DB::connection('data_process')->table('khoan_muc')->get();
            return response()->json([
                'success' => true,
                'message' => 'Successfully',
                'data' => $data,
                'meta' => (object) [],
            ], 200);
        } catch (Exception $e) {
            abort(500);
        }
    }
    //cái này a vũ viết nè, nhưng sao lại phải upload file theo cách này nhỉ? à có lẽ là lưu vào minio.db, để dễ dàng tải xuống, bổ xung
    public function uploadFile(Request $laravel_request, $request_id)
    {
        // $this->validateFile(($file = $receiver->receive()->getFile()));
        if ($request_id != 0) {
            $request = ProcessRequest::find($request_id);

            if (!Auth::user()->can('view', $request)) {
                abort(403);
            }
        } else {
            $request = null;
        }
        //delete it and upload the new one
        return $this->chunkFile($request, $laravel_request);
    }
    public function uploadFile3(Request $request)
    {
        return response()->json(['thành cmn công rồi' => 'No file uploaded'], 400);
    }
    public function uploadFile4(Request $request)
    {
        $request->validate([
            'file' => [
                'required',
                'file'
            ],
        ]);
        Excel::import(new Create_import_table, $request->file('file'));
        return response()->json(['thành cmn công rồi' => 'đã được lưu'], 200);
    }
    public function uploadFile2(Request $request)
    {
        $request->validate([
            'file' => [
                'required',
                'file'
            ],
        ]);
        // Lấy dữ liệu từ body của request
        $bodyData = $request->except('file');
        Excel::import(new FileImport($bodyData), $request->file('file'));

        return response()->json(['done' => 'Uploaded Successful'], 200);
    }
    //hiển thị toàn bộ report
    public function showReport(Request $request)
    {
        try {
            $data = DB::table('vtg_list_ke_hoach_khac')->get();
            return response()->json([
                'success' => true,
                'message' => 'Successfully',
                'data' => $data,
            ], 200);
        } catch (Exception $e) {
            abort(500);
        }
    }
    public function showReportcomparative(Request $request)
    {
        //sau khi có đủ thông tin thì tìm kiếm trong báo cáo
        $id1 = $request['id1'];
        $id2 = $request['id2'];
        //save db report with id1
        $this->detailReport($id1);
        //save db report with id2
        $this->detailReport2($id2);
        //save db with Discrepancy

    }
    //dữ liệu thực hiện
    public function detailReport($id)
    {
        try {
            //từ id lấy dữ liệu báo cáo hợp nhất
            $data = DB::table('vtg.hop_nhat')
                ->where('process_id', $id)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            // Lặp qua từng bản ghi và chèn vào bảng mình muốn lưu nếu có cấu trúc giống bảng ban đầu
            foreach ($data as $record) {
                DB::table('target_table')->insert((array) $record);
            }
            //$data = DB::table('your_table_name')->get();
            // Khởi tạo mảng để chứa các trường (column names) lấy từ hàng số 4
            // Tạo mảng $fields chỉ chứa 7 cột đầu tiên của từng bản ghi
            // Khởi tạo mảng trống để chứa kết quả
            $fields = [];
            $value = [];
            // Dùng vòng for để lặp qua từng phần tử trong $data
            foreach ($data as $index => $item) {
                $value[$item->company_id] = $item->value ?? null;
                if (($index - 17) % 18 == 0) {
                    $fields[] = array_merge(
                        [
                            'id' => $item->ID ?? null,             // Cột 1
                            'report_name' => $item->report_name ?? null, // Cột 2
                            'period_id' => $item->period_id ?? null,     // Cột 3
                            'type_period' => $item->type_period ?? null, // Cột 4
                            'month' => $item->month ?? null,             // Cột 5
                            'year' => $item->year ?? null,               // Cột 6
                            'code' => $item->code ?? null,               // Cột 7
                            'index' => $item->index ?? null,             // Cột 8
                            'khoan_muc_id' => $item->khoan_muc_id ?? null,
                            'total' => $item->total ?? null,
                            'hop_nhat' => $item->hop_nhat ?? null,
                            'hop_nhat_vtp' => $item->hop_nhat_vtp ?? null,
                            'hop_nhat_tru_lo' => $item->hop_nhat_tru_lo ?? null,
                            'vtg_no_dividend' => $item->vtg_no_dividend ?? null,
                            'vtg_dividend' => $item->vtg_dividend ?? null,
                            'vtg_net' => $item->vtg_net ?? null,
                            'dc_tt' => $item->dc_tt ?? null,
                            'dc_cltg' => $item->dc_cltg ?? null,
                            'dc_khac' => $item->dc_khac ?? null,
                        ],
                        ['company_id' => $value]
                    );
                    $value = [];
                }
            }
            // Chèn vào bảng nguyên mẫu mong muốn
            DB::table('report_data')->insert($fields);
            // Trả về kết quả
            return response()->json([
                'success' => true,
                'data' => $fields
            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }
    //dữ liệu cùng kỳ tương tự dữ liệu thực hiện, khác ở cái đk lấy trong db có lẽ sẽ khác thôi
    public function detailReport2($id)
    {
        try {
            //từ id lấy dữ liệu báo cáo hợp nhất
            $data = DB::table('vtg.hop_nhat')
                ->where('process_id', $id)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            // Lặp qua từng bản ghi và chèn vào bảng mình muốn lưu nếu có cấu trúc giống bảng ban đầu
            foreach ($data as $record) {
                DB::table('target_table')->insert((array) $record);
            }
            //$data = DB::table('your_table_name')->get();
            // Khởi tạo mảng để chứa các trường (column names) lấy từ hàng số 4
            // Tạo mảng $fields chỉ chứa 7 cột đầu tiên của từng bản ghi
            // Khởi tạo mảng trống để chứa kết quả
            $fields = [];
            $value = [];
            // Dùng vòng for để lặp qua từng phần tử trong $data
            foreach ($data as $index => $item) {
                $value[$item->company_id] = $item->value ?? null;
                if (($index - 17) % 18 == 0
                ) {
                    $fields[] = array_merge(
                        [
                            'id' => $item->ID ?? null,             // Cột 1
                            'report_name' => $item->report_name ?? null, // Cột 2
                            'period_id' => $item->period_id ?? null,     // Cột 3
                            'type_period' => $item->type_period ?? null, // Cột 4
                            'month' => $item->month ?? null,             // Cột 5
                            'year' => $item->year ?? null,               // Cột 6
                            'code' => $item->code ?? null,               // Cột 7
                            'index' => $item->index ?? null,             // Cột 8
                            'khoan_muc_id' => $item->khoan_muc_id ?? null,
                            'total' => $item->total ?? null,
                            'hop_nhat' => $item->hop_nhat ?? null,
                            'hop_nhat_vtp' => $item->hop_nhat_vtp ?? null,
                            'hop_nhat_tru_lo' => $item->hop_nhat_tru_lo ?? null,
                            'vtg_no_dividend' => $item->vtg_no_dividend ?? null,
                            'vtg_dividend' => $item->vtg_dividend ?? null,
                            'vtg_net' => $item->vtg_net ?? null,
                            'dc_tt' => $item->dc_tt ?? null,
                            'dc_cltg' => $item->dc_cltg ?? null,
                            'dc_khac' => $item->dc_khac ?? null,
                        ],
                        ['company_id' => $value]
                    );
                    $value = [];
                }
            }
            // Chèn vào bảng nguyên mẫu mong muốn
            DB::table('report_data')->insert($fields);
            // Trả về kết quả
            return response()->json([
                'success' => true,
                'data' => $fields
            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }
    //dữ liệu chênh lệch
    public function Discrepancy($id1, $id2)
    {
        try {
            //từ id lấy dữ liệu báo cáo hợp nhất
            $data1 = DB::table('vtg.hop_nhat')
                ->where('process_id', $id1)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            $data2 = DB::table('vtg.hop_nhat')
                ->where('process_id', $id2)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            // Nếu chỉ cần tính toán và lưu thì sẽ lưu vào đây
            // Duyệt qua từng bản ghi trong data1
            foreach ($data1 as $index => $record1) {
                // Tìm bản ghi tương ứng trong data2 (có cùng id)
                $record2 = $data2->firstWhere('id', $record1->id);

                if ($record2) {
                    // Tính toán sự khác biệt cho các trường value và target
                    $record1->total = $record1->total - $record2->total;
                    $record1->hop_nhat = $record1->hop_nhat - $record2->hop_nhat;
                    $record1->hop_nhat_vtp = $record1->hop_nhat_vtp - $record2->hop_nhat_vtp;
                    $record1->hop_nhat_tru_lo = $record1->hop_nhat_tru_lo - $record2->hop_nhat_tru_lo;
                    $record1->vtg_no_dividend = $record1->vtg_no_dividend - $record2->vtg_no_dividend;
                    $record1->vtg_dividend = $record1->vtg_dividend - $record2->vtg_dividend;
                    $record1->vtg_net = $record1->vtg_net - $record2->vtg_net;
                    $record1->dc_tt = $record1->dc_tt - $record2->dc_tt;
                    $record1->dc_cltg = $record1->dc_cltg - $record2->dc_cltg;
                    $record1->dc_khac = $record1->dc_khac - $record2->dc_khac;

                    // Chèn bản ghi đã hợp nhất vào bảng target_table
                    DB::table('target_table')->insert((array) $record1);
                }
            }
            //ở đây đáng lẽ lấy cùng 1 db nhưng khác request_id
            //$data = DB::table('your_table_name')->where('request_id', 'A')->get();
            /* $data1 = DB::table('your_table_name')->get();
            $data2 = DB::table('your_table_name1')->get(); */

            $fields = [];
            $value = [];
            // Dùng vòng for để lặp qua từng phần tử trong $data
            foreach ($data1 as $index => $item) {
                $value[$item->company_id] = $item->value - $data2[$index]->value;
                if (($index - 17) % 18 == 0) {
                    $fields[] = array_merge(
                        [
                            'id' => $item->ID ?? null,             // Cột 1
                            'report_name' => $item->report_name ?? null, // Cột 2
                            'period_id' => $item->period_id ?? null,     // Cột 3
                            'type_period' => $item->type_period ?? null, // Cột 4
                            'month' => $item->month ?? null,             // Cột 5
                            'year' => $item->year ?? null,               // Cột 6
                            'code' => $item->code ?? null,               // Cột 7
                            'index' => $item->index ?? null,             // Cột 8
                            'khoan_muc_id' => $item->khoan_muc_id ?? null,
                            'total' => $item->total - $data2[$index]->total,
                            'hop_nhat' => $item->hop_nhat - $data2[$index]->hop_nhat,
                            'hop_nhat_vtp' => $item->hop_nhat_vtp - $data2[$index]->hop_nhat_vtp,
                            'hop_nhat_tru_lo' => $item->hop_nhat_tru_lo - $data2[$index]->hop_nhat_tru_lo,
                            'vtg_no_dividend' => $item->vtg_no_dividend - $data2[$index]->vtg_no_dividend,
                            'vtg_dividend' => $item->vtg_dividend - $data2[$index]->vtg_dividend,
                            'vtg_net' => $item->vtg_net - $data2[$index]->vtg_net,
                            'dc_tt' => $item->dc_tt - $data2[$index]->dc_tt,
                            'dc_cltg' => $item->dc_cltg - $data2[$index]->dc_cltg,
                            'dc_khac' => $item->dc_khac - $data2[$index]->dc_khac,
                        ],
                        ['company_id' => $value]
                    );
                    $value = [];
                }
            }
            // Chèn vào bảng nguyên mẫu mong muốn
            DB::table('report_data')->insert($fields);
            // Trả về kết quả
            return response()->json([
                'success' => true,
                'fields' => $fields
            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }
    //hàm lấy kết quả theo bảng tỷ lệ tăng trưởng
    private function calculate($a, $b)
    {
        if ($b > 0 && $a > 0) {
            return round($a / $b, 1);  // Làm tròn đến 1 chữ số thập phân
        } elseif ($b > 0 && $a < 0) {
            return round(-1 - abs($a / $b), 1);  // Làm tròn đến 1 chữ số thập phân
        } elseif ($b < 0 && $a > 0) {
            return round(1 + abs($a / $b), 1);  // Làm tròn đến 1 chữ số thập phân
        } elseif ($b < 0 && $a < 0 && $a < $b) {
            return round(1 - abs(abs($a) - abs($b)) / abs($b), 1);  // Làm tròn đến 1 chữ số thập phân
        } elseif ($b < 0 && $a < 0 && $a > $b) {
            return round(1 + abs(abs($a) - abs($b)) / abs($b), 1);  // Làm tròn đến 1 chữ số thập phân
        } elseif ($b == 0 && $a != 0) {
            return "";  // Chuỗi rỗng
        } elseif ($b < 0 && $a == 0) {
            return 2;
        } elseif ($b == $a) {
            return 1;
        } else {
            return 0;
        }
    }
    //tỷ lệ tăng chưởng
    public function growth_rate($id1, $id2)
    {
        try {
            //từ id lấy dữ liệu báo cáo hợp nhất
            $data1 = DB::table('vtg.hop_nhat')
                ->where('process_id', $id1)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            $data2 = DB::table('vtg.hop_nhat')
                ->where('process_id', $id2)
                ->orderBy('id', 'asc') // Sắp xếp theo id tăng dần (thứ tự mặc định)
                ->get();
            // Nếu chỉ cần tính toán và lưu thì sẽ lưu vào đây
            // Duyệt qua từng bản ghi trong data1
            foreach ($data1 as $index => $record1) {
                // Tìm bản ghi tương ứng trong data2 (có cùng id)
                $record2 = $data2->firstWhere('id', $record1->id);

                if ($record2) {
                    // Tính toán sự khác biệt cho các trường value và target
                    $record1->total = $this->calculate($record1->total, $record2->total);
                    $record1->hop_nhat = $this->calculate($record1->hop_nhat, $record2->hop_nhat);
                    $record1->hop_nhat_vtp = $this->calculate($record1->hop_nhat_vtp, $record2->hop_nhat_vtp);
                    $record1->hop_nhat_tru_lo = $this->calculate($record1->hop_nhat_tru_lo, $record2->hop_nhat_tru_lo);
                    $record1->vtg_no_dividend = $this->calculate($record1->vtg_no_dividend, $record2->vtg_no_dividend);
                    $record1->vtg_dividend = $this->calculate($record1->vtg_dividend, $record2->vtg_dividend);
                    $record1->vtg_net = $this->calculate($record1->vtg_net, $record2->vtg_net);
                    $record1->dc_tt = $this->calculate($record1->dc_tt, $record2->dc_tt);
                    $record1->dc_cltg = $this->calculate($record1->dc_cltg, $record2->dc_cltg);
                    $record1->dc_khac = $this->calculate($record1->dc_khac, $record2->dc_khac);

                    // Chèn bản ghi đã hợp nhất vào bảng target_table
                    DB::table('target_table')->insert((array) $record1);
                }
            }
            //ở đây đáng lẽ lấy cùng 1 db nhưng khác request_id
            //$data = DB::table('your_table_name')->where('request_id', 'A')->get();
            /* $data = DB::table('your_table_name')->get();
            $data_discrepancy = DB::table('your_table_name1')->get(); */

            $fields = [];
            $value = [];
            // Dùng vòng for để lặp qua từng phần tử trong $data
            foreach ($data1 as $index => $item) {
                $value[$item->company_id] = $this->calculate($item->value, $data2[$index]->value);
                if (($index - 17) % 18 == 0) {
                    $fields[] = array_merge(
                        [
                            'id' => $item->ID ?? null,
                            'report_name' => $item->report_name ?? null,
                            'period_id' => $item->period_id ?? null,
                            'type_period' => $item->type_period ?? null,
                            'month' => $item->month ?? null,
                            'year' => $item->year ?? null,
                            'code' => $item->code ?? null,
                            'index' => $item->index ?? null,
                            'khoan_muc_id' => $item->khoan_muc_id ?? null,
                            'total' => $this->calculate($item->total, $data2[$index]->total),
                            'hop_nhat' => $this->calculate($item->hop_nhat, $data2[$index]->hop_nhat),
                            'hop_nhat_vtp' => $this->calculate($item->hop_nhat_vtp, $data2[$index]->hop_nhat_vtp),
                            'hop_nhat_tru_lo' => $this->calculate($item->hop_nhat_tru_lo, $data2[$index]->hop_nhat_tru_lo),
                            'vtg_no_dividend' => $this->calculate($item->vtg_no_dividend, $data2[$index]->vtg_no_dividend),
                            'vtg_dividend' => $this->calculate($item->vtg_dividend, $data2[$index]->vtg_dividend),
                            'vtg_net' => $this->calculate($item->vtg_net, $data2[$index]->vtg_net),
                            'dc_tt' => $this->calculate($item->dc_tt, $data2[$index]->dc_tt),
                            'dc_cltg' => $this->calculate($item->dc_cltg, $data2[$index]->dc_cltg),
                            'dc_khac' => $this->calculate($item->dc_khac, $data2[$index]->dc_khac),
                        ],
                        ['company_id' => $value]
                    );
                    $value = [];
                }
            }
            // Chèn vào bảng nguyên mẫu mong muốn
            DB::table('report_data')->insert($fields);
            // Trả về kết quả
            return response()->json([
                'success' => true,
                'data' => $fields
            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }

    private function getDataCumulativeTH($month)
    {
        $months = [];
        $quarters = [];
        $typePeriod = [];
        if ($month == '01') {
            $months[] = '01';
        } else if ($month == '02') {
            $months[] = '01';
            $months[] = '02';
        } else if ($month == '03') {
            $quarters[] = '1';
        } else if ($month == '04') {
            $quarters[] = '1';
            $months[] = '04';
        } else if ($month == '05') {
            $quarters[] = '1';
            $months[] = '04';
            $months[] = '05';
        } else if ($month == '06') {
            $typePeriod[] = '6-first-month';
        } else if ($month == '07') {
            $typePeriod[] = '6-first-month';
            $months[] = '07';
        } else if ($month == '08') {
            $months[] = '07';
            $months[] = '08';
            $typePeriod[] = '6-first-month';
        } else if ($month == '09') {
            $typePeriod[] = '9-first-month';
        } else if ($month == '10') {
            $months[] = '10';
            $typePeriod[] = '9-first-month';
        } else if ($month == '11') {
            $months[] = '10';
            $months[] = '11';
            $typePeriod[] = '9-first-month';
        } else if ($month == '12') {
            $typePeriod[] = 'year';
        }
        return [$months, $quarters, $typePeriod];
    }

    private function getDataCumulativeKH($month)
    {
        $months = [];
        $quarters = [];
        if ($month == '01') {
            $months[] = '01';
        } else if ($month == '02') {
            $months[] = '01';
            $months[] = '02';
        } else if ($month == '03') {
            $quarters[] = '1';
        } else if ($month == '04') {
            $quarters[] = '1';
            $months[] = '04';
        } else if ($month == '05') {
            $quarters[] = '1';
            $months[] = '04';
            $months[] = '05';
        } else if ($month == '06') {
            $quarters[] = '1';
            $quarters[] = '2';
        } else if ($month == '07') {
            $months[] = '07';
            $quarters[] = '1';
            $quarters[] = '2';
        } else if ($month == '08') {
            $months[] = '07';
            $months[] = '08';
            $quarters[] = '1';
            $quarters[] = '2';
        } else if ($month == '09') {
            $quarters[] = '1';
            $quarters[] = '2';
            $quarters[] = '3';
        } else if ($month == '10') {
            $months[] = '10';
            $quarters[] = '1';
            $quarters[] = '2';
            $quarters[] = '3';
        } else if ($month == '11') {
            $months[] = '10';
            $months[] = '11';
            $quarters[] = '1';
            $quarters[] = '2';
            $quarters[] = '3';
        } else if ($month == '12') {
            $typePeriod[] = 'year';
        }
        return [$months, $quarters];
    }
    public function showtest(Request $request)
    {
        $typePeriod = $request['typePeriod'];


        return [
            'data' => $this->handleTypePeriod($typePeriod),

        ];
    }

    public function getDepartment(Request $request)
    {
        $department = new Department();

        $department_id = auth()->user()->department_id;
        $query = $department::where('id', $department_id)->get(['id', 'name', 'topdown_route']);
        if ($query->contains('id', 165318)) {
            // Loại bỏ gạch chéo ở đầu và cuối chuỗi (nếu có)
            $trimmedString = trim($query['topdown_route'], '/');

            // Tách chuỗi thành mảng
            $elements = explode('/', $trimmedString);
            return response()->json([
                'success' => true,
                'department' => $query,
                'elements' => $elements
            ]);
        }

        return response()->json([
            'success' => true,
            'data' => $query
        ]);
    }

    private function handleTypePeriod($typePeriod)
    {
        $period = '';
        $month = '';
        $quarter = '';
        if ($typePeriod <= 12) {
            $period = 'month';
            $month = str_pad($typePeriod, 2, '0', STR_PAD_LEFT);
        } else if (13 <= $typePeriod && $typePeriod <= 16) {
            $period = 'quarter';
            $quarter = (string)($typePeriod - 12);
        } else {
            if ($typePeriod == 17)
                $period = '6-first-month';
            else if ($typePeriod == 18)
                $period = '6-last-month';
            else if ($typePeriod == 19)
                $period = '9-first-month';
            else
                $period = 'year';
        }
        return [$period, $month, $quarter];
    }
    //đơn vị,năm,kỳ báo cáo là lấy từ request,loại báo cáo sẽ được lấy?
    public function getTypeReport(Request $request)
    {
        try {
            $type_reports = [];
            $year = $request->query('year');
            $typePeriod = $request->query('typePeriod');
            if (!$year || !$typePeriod) {
                return response()->json([
                    'success' => false,
                    'message' => 'Missing required parameters: year or typePeriod',
                ], 400);
            }
            $period = $this->handleTypePeriod($typePeriod)[0];
            $quarter = $this->handleTypePeriod($typePeriod)[2];
            $month = $this->handleTypePeriod($typePeriod)[1];
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->pluck('data');
            if ($period == 'quarter')
                $dataOther = DB::table('vtg_list_ke_hoach_khac')
                    ->where('year', $year)
                    ->where('type_period', $period);

            if ($period == 'quarter') {
                //xác định tồn tại thực hiện/kế hoạch
                $execute = $data->filter(function ($item) use ($year, $quarter) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        $decoded['quy'] === $quarter &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                $plan = $data->filter(function ($item) use ($year, $quarter) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        $decoded['quy'] === $quarter &&
                        $decoded['loai_dl'] === '1';
                });
                if ($execute->isNotEmpty() && ($plan->isNotEmpty() || $dataOther->isNotEmpty())) {
                    $type_reports[] = 'Báo cáo so sánh kỳ thực hiện với số kế hoạch';
                }

                //xác định tồn tại thực hiện/thực hiện cùng kỳ
                $executeSamePeriod = $data->filter(function ($item) use ($year, $quarter) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        (int)$decoded['nam'] === $year - 1 &&
                        $decoded['quy'] === $quarter &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                if ($execute->isNotEmpty() && $executeSamePeriod->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số cùng kỳ';
                }

                //xác định tồn tại thực hiện/ liền kề
                $adjacent = $data->filter(function ($item) use ($year, $quarter) {
                    $decoded = json_decode($item, true);
                    if ($quarter == '1') {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year - 1 &&
                            $decoded['quy'] === '4' &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    } else {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year &&
                            (int)$decoded['quy'] === $quarter - 1 &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    }
                });
                if ($execute->isNotEmpty() && $adjacent->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số liền kề';
                }
            } else if ($period == 'month') {
                //xác định tồn tại thực hiện/kế hoạch
                $commonData = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['thang'] === $month;
                });
                $execute = $commonData->filter(function ($item) use ($month, $year) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                $plan = $commonData->filter(function ($item) use ($month, $year) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        $decoded['loai_dl'] === '1';
                });
                if ($execute->isNotEmpty() && ($plan->isNotEmpty() || $dataOther->isNotEmpty())) {
                    $type_reports[] = 'Báo cáo so sánh kỳ thực hiện với số kế hoạch';
                }

                //xác định tồn tại thực hiện/thực hiện cùng kỳ
                $executeSamePeriod = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        (int)$decoded['nam'] === $year - 1 &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                if ($execute->isNotEmpty() && $executeSamePeriod->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số cùng kỳ';
                }
                //xác định tồn tại thực hiện/ liền kề
                $adjacent = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    if ($month == '01') {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year - 1 &&
                            $decoded['thang'] === '12' &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    } else {
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] === $year &&
                            (int)$decoded['thang'] === $month - 1 &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    }
                });
                if ($execute->isNotEmpty() && $adjacent->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số liền kề';
                }
                //xác định tồn tại luỹ kế thực hiện
                $satisfy1 = true;
                $satisfy2 = true;
                $satisfy3 = true;
                $satisfy4 = true;
                $dataCumulativeTH = $this->getDataCumulativeTH($month);
                $dataCumulativeKH = $this->getDataCumulativeKH($month);
                $cumulativeTH = $commonData->filter(function ($item) use ($year, $dataCumulativeTH) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        in_array($decoded['thang'], $dataCumulativeTH) &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                for ($i = 0; $i < count($dataCumulativeTH[0]); $i++) {
                    $cumulativeTH = $commonData->filter(function ($item) use ($year, $month, $i, $dataCumulativeTH) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] === $year &&
                            $decoded['thang'] === $dataCumulativeTH[0][$i] &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy1 == false;
                        $satisfy2 == false;
                        $satisfy3 == false;
                        $satisfy4 == false;
                    }
                }
                if (count($dataCumulativeTH[1]) > 0) {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', ['quarter'])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                        ->pluck('data');
                    $cumulativeTH = $dataNew->filter(function ($item) use ($dataCumulativeTH) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            $decoded['quy'] === $dataCumulativeTH[1][0] &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy1 == false;
                        $satisfy2 == false;
                        $satisfy3 == false;
                        $satisfy4 == false;
                    }
                }
                if (count($dataCumulativeTH[2]) > 0) {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$dataCumulativeTH[2][0]])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                        ->pluck('data');
                    $cumulativeTH = $dataNew->filter(function ($item) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy1 == false;
                        $satisfy2 == false;
                        $satisfy3 == false;
                        $satisfy4 == false;
                    }
                }

                //xác định tồn tại luỹ kế kế hoạch
                for ($i = 0; $i < count($dataCumulativeKH[0]); $i++) {
                    $cumulativeTH = $commonData->filter(function ($item) use ($year, $i, $dataCumulativeTH) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] === $year &&
                            $decoded['thang'] === $dataCumulativeTH[0][$i] &&
                            ($decoded['loai_dl'] === '1');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy1 == false;
                    }
                }
                if (count($dataCumulativeKH[1]) > 0) {
                    for ($i = 0; $i < count($dataCumulativeKH[1]); $i++) {
                        $dataNew1 = DB::table('process_requests')
                            ->where('application_id', 73)
                            ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', ['quarter'])
                            ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                            ->pluck('data');
                        $cumulativeTH = $dataNew1->filter(function ($item) use ($dataCumulativeKH, $i) {
                            $decoded = json_decode($item, true);
                            return isset($decoded['loai_dl']) &&
                                $decoded['quy'] === $dataCumulativeKH[1][$i] &&
                                ($decoded['loai_dl'] === '1');
                        });
                        if ($cumulativeTH->isEmpty()) {
                            $satisfy1 == false;
                        }
                    }
                }

                //xác định tồn tại luỹ kế kế hoạch khác
                /* for ($i = 0; $i < count($this->getDataCumulativeKH($month)[0]); $i++) {
                    $cumulativeTH = $dataOther->filter(function ($item) use ($year, $month, $i) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] === $year &&
                            $decoded['thang'] === $this->getDataCumulativeTH($month)[0][$i] &&
                            ($decoded['loai_dl'] === '1');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy2 == false;
                    }
                }
                if (count($this->getDataCumulativeKH($month)[1]) > 0) {
                    for ($i = 0; $i < count($this->getDataCumulativeKH($month)[1]); $i++) {
                        $dataNew1 = DB::table('reports_import')
                            ->where('report_year', $year)
                            ->where('report_period', 'quarter');
                        $cumulativeTH = $dataNew1->filter(function ($item) use ($month, $i) {
                            $decoded = json_decode($item, true);
                            return isset($decoded['loai_dl']) &&
                                $decoded['quy'] === $this->getDataCumulativeKH($month)[1][$i];
                        });
                        if ($cumulativeTH->isEmpty()) {
                            $satisfy2 == false;
                        }
                    }
                } */

                //xác định tồn tại luỹ kế thực hiện với cùng kỳ
                for ($i = 0; $i < count($dataCumulativeTH[0]); $i++) {
                    $cumulativeTH = $data->filter(function ($item) use ($year, $i, $dataCumulativeTH) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year - 1 &&
                            $decoded['thang'] === $dataCumulativeTH[0][$i] &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy3 == false;
                    }
                }
                if (count($dataCumulativeTH[1]) > 0) {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', ['quarter'])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(string)($year - 1)])
                        ->pluck('data');
                    $cumulativeTH = $dataNew->filter(function ($item) use ($dataCumulativeTH) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            $decoded['quy'] === $dataCumulativeTH[1][0] &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy3 == false;
                    }
                }
                if (count($dataCumulativeTH[2]) > 0) {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$dataCumulativeTH[2][0]])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(string)($year - 1)])
                        ->pluck('data');
                    $cumulativeTH = $dataNew->filter(function ($item) {
                        $decoded = json_decode($item, true);
                        return isset($decoded['loai_dl']) &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    });
                    if ($cumulativeTH->isEmpty()) {
                        $satisfy3 == false;
                    }
                }


                if ($satisfy1 == true) {
                    $type_reports[] = 'Báo cáo so sánh thực hiện lũy kế so với kế  hoạch lũy kế';
                }
                if ($satisfy2 == true) {
                    $type_reports[] = 'Báo cáo so sánh thực hiện lũy kế so với kế  hoạch khác';
                }
                if ($satisfy3 == true) {
                    $type_reports[] = 'Báo cáo so sánh lũy kế cùng kỳ';
                }
            } else {
                //xác định tồn tại thực hiện/kế hoạch
                $execute = $data->filter(function ($item) use ($year) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                $plan = $data->filter(function ($item) use ($year) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        $decoded['nam'] === $year &&
                        $decoded['loai_dl'] === '1';
                });
                if ($execute->isNotEmpty() && ($plan->isNotEmpty() || $dataOther->isNotEmpty())) {
                    $type_reports[] = 'Báo cáo so sánh kỳ thực hiện với số kế hoạch';
                }

                //xác định tồn tại thực hiện/thực hiện cùng kỳ
                $executeSamePeriod = $data->filter(function ($item) use ($year) {
                    $decoded = json_decode($item, true);
                    return isset($decoded['loai_dl']) &&
                        (int)$decoded['nam'] === $year - 1 &&
                        ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                });
                if ($execute->isNotEmpty() && $executeSamePeriod->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số cùng kỳ';
                }

                //xác định tồn tại thực hiện/ liền kề
                $adjacent = $data->filter(function ($item) use ($year, $period) {
                    $decoded = json_decode($item, true);
                    if ($period == '9-fist-month' || 'year') {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year - 1 &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    } else if ($period == '6-first-month') {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year - 1 &&
                            (int)$decoded['ky_bc'] === '6-last-month' &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    } else {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] === $year &&
                            (int)$decoded['ky_bc'] === '6-first-month' &&
                            ($decoded['loai_dl'] === '3' || $decoded['loai_dl'] === '4');
                    }
                });
                if ($execute->isNotEmpty() && $adjacent->isNotEmpty()) {
                    $type_reports[] = 'Báo cáo so sánh số thực hiện với số liền kề';
                }
            }


            $names = $data->map(function ($item) {
                $decoded = json_decode($item, true); // Giải mã trực tiếp mỗi phần tử
                return [
                    'thang' => $decoded['thang'] ?? null,
                    'quy' => $decoded['quy'] ?? null,
                    'ky_bc' => $decoded['ky_bc'] ?? null,
                    'nam' => $decoded['nam'] ?? null,
                    'loai_dl' => $decoded['loai_dl'] ?? null,
                    'thang' => $decoded['thang'] ?? null
                ];
            });
            return response()->json([
                'success' => true,
                'data' => $type_reports,
            ]);
            return response()->json([
                'success' => true,
                'type_reports' => $type_reports,
                'yeah' => $year,
                'period' => $period,
                'data' => $names,

            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }
    public function getListCodes(Request $request)
    {
        try {
            $codes = DB::table('khoan_muc')->get();
            $nameCodes = $codes->map(function ($item) {
                return [
                    'code' => $item->code ?? null,
                    'name' => $item->name_vie ?? null,
                ];
            });
            return response()->json([
                'success' => true,
                'data' => $nameCodes
            ]);
        } catch (Exception $e) {
            abort(500);
        }
    }

    public function getNameRequirementTH(Request $request)
    {
        $year = $request->query('year');
        $typePeriod = $request->query('typePeriod');
        if (!$year || !$typePeriod) {
            return response()->json([
                'success' => false,
                'message' => 'Missing required parameters: year or typePeriod',
            ], 400);
        }
        $period = $this->handleTypePeriod($typePeriod)[0];
        $quarter = $this->handleTypePeriod($typePeriod)[2];
        $month = $this->handleTypePeriod($typePeriod)[1];
        if ($period <= 12) {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.thang")) = ?', [$month])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                ->pluck('data');
        } else if ($period == 'quarter') {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.quy")) = ?', [$quarter])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                ->pluck('data');
        }
        //nếu có N3
        $nameRequirement = $data->filter(function ($item) {
            $decoded = json_decode($item, true);
            if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                return isset($decoded['loai_dl']) &&
                    $decoded['ktth_vtg_pd'] == 1 &&
                    $decoded['loai_dl'] == 3;
            } else {
                return isset($decoded['loai_dl']) &&
                    $decoded['loai_dl'] == 3;
            }
        });
        //ko có thì kiếm N25
        if ($nameRequirement->isEmpty()) {
            $nameRequirement = $data->filter(function ($item) {
                $decoded = json_decode($item, true);
                if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                    return $decoded['ktth_vtg_pd'] == 1 &&
                        $decoded['loai_dl'] == 4;
                } else {
                    return isset($decoded['loai_dl']) &&
                        $decoded['loai_dl'] == 4;
                }
            });
        }
        if ($nameRequirement->isEmpty()) {
            return response()->json([
                'success' => true,
                'data' => 'no report requirement for the selected reporting period.',
            ]);
        }
        $names = $nameRequirement->map(function ($item) {
            $decoded = json_decode($item, true); // Giải mã trực tiếp mỗi phần tử
            return [
                'name' => $decoded['name'] ?? null,
                'id' => $decoded['id'] ?? null,
            ];
        });
        return response()->json([
            'success' => true,
            'data' => $names
        ]);
    }
    public function getNameRequirementKH(Request $request)
    {
        $year = $request->query('year');
        $typePeriod = $request->query('typePeriod');
        if (!$year || !$typePeriod) {
            return response()->json([
                'success' => false,
                'message' => 'Missing required parameters: year or typePeriod',
            ], 400);
        }
        $period = $this->handleTypePeriod($typePeriod)[0];
        $quarter = $this->handleTypePeriod($typePeriod)[2];
        $month = $this->handleTypePeriod($typePeriod)[1];
        if ($period == 'month') {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.thang")) = ?', [$month])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                ->pluck('data');
        } else if ($period == 'quarter') {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.quy")) = ?', [$quarter])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                ->pluck('data');
        } else {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                ->pluck('data');
        }

        //nếu có N3
        $nameRequirement = $data->filter(function ($item) {
            $decoded = json_decode($item, true);
            if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                return isset($decoded['loai_dl']) &&
                    $decoded['ktth_vtg_pd'] == 1 &&
                    $decoded['loai_dl'] == 1;
            } else {
                return isset($decoded['loai_dl']) &&
                    $decoded['loai_dl'] == 1;
            }
        });


        if ($period == "month") {
            $dataOther = DB::table('vtg_list_ke_hoach_khac')
                ->where('report_year', $year)
                ->where('type_period ', $period)
                ->where('month ', $month);
        } else if ($period == "quarter") {
            $dataOther = DB::table('vtg_list_ke_hoach_khac')
                ->where('report_year', $year)
                ->where('type_period ', $period)
                ->where('quarter ', $quarter);
        } else {
            $dataOther = DB::table('vtg_list_ke_hoach_khac')
                ->where('report_year', $year)
                ->where('type_period ', $period);
        }


        if ($nameRequirement->isEmpty() && $dataOther->isEmpty()) {
            return response()->json([
                'success' => true,
                'data' => 'no report requirement for the selected reporting period.',
            ]);
        }

        if ($nameRequirement->isNotEmpty()) {
            $names = $nameRequirement->map(function ($item) {
                $decoded = json_decode($item, true); // Giải mã trực tiếp mỗi phần tử
                return $decoded['name'] ?? null;
            });
        }

        /* if($dataOther->isNotEmpty()) {
            $name[] = $dataOther['name'];
        } */

        return response()->json([
            'success' => true,
            'data' => $names
        ]);
    }

    public function getNameRequirementTHSamePeriod(Request $request)
    {
        $year = $request->query('year');
        $typePeriod = $request->query('typePeriod');
        if (!$year || !$typePeriod) {
            return response()->json([
                'success' => false,
                'message' => 'Missing required parameters: year or typePeriod',
            ], 400);
        }
        $period = $this->handleTypePeriod($typePeriod)[0];
        $quarter = $this->handleTypePeriod($typePeriod)[2];
        $month = $this->handleTypePeriod($typePeriod)[1];
        if ($typePeriod == 'month') {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.thang")) = ?', [$month])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(int)($year - 1)])
                ->pluck('data');
        } else if ($period == 'quarter') {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.quy")) = ?', [$quarter])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(int)($year - 1)])
                ->pluck('data');
        } else {
            $data = DB::table('process_requests')
                ->where('application_id', 73)
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
                ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(int)($year - 1)])
                ->pluck('data');
        }
        //nếu có N3
        $nameRequirement = $data->filter(function ($item) {
            $decoded = json_decode($item, true);
            if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                return isset($decoded['loai_dl']) &&
                    $decoded['ktth_vtg_pd'] == 1 &&
                    $decoded['loai_dl'] == 3;
            } else {
                return isset($decoded['loai_dl']) &&
                    $decoded['loai_dl'] == 3;
            }
        });
        //ko có thì kiếm N25
        if ($nameRequirement->isEmpty()) {
            $nameRequirement = $data->filter(function ($item) {
                $decoded = json_decode($item, true);
                if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                    return isset($decoded['loai_dl']) &&
                        $decoded['ktth_vtg_pd'] == 1 &&
                        $decoded['loai_dl'] == 4;
                } else {
                    return isset($decoded['loai_dl']) &&
                        $decoded['loai_dl'] == 4;
                }
            });
        }
        if ($nameRequirement->isEmpty()) {
            return response()->json([
                'success' => true,
                'data' => 'no report requirement for the selected reporting period.',
            ]);
        }
        $names = $nameRequirement->map(function ($item) {
            $decoded = json_decode($item, true); // Giải mã trực tiếp mỗi phần tử
            return $decoded['name'] ?? null;
        });
        return response()->json([
            'success' => true,
            'data' => $names
        ]);
    }

    public function getNameRequirementTHAdjacent(Request $request)
    {
        $year = $request->query('year');
        $typePeriod = $request->query('typePeriod');
        if (!$year || !$typePeriod) {
            return response()->json([
                'success' => false,
                'message' => 'Missing required parameters: year or typePeriod',
            ], 400);
        }
        $period = $this->handleTypePeriod($typePeriod)[0];
        $quarter = $this->handleTypePeriod($typePeriod)[2];
        $month = $this->handleTypePeriod($typePeriod)[1];
        $data = DB::table('process_requests')
            ->where('application_id', 73)
            ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$period])
            ->pluck('data');
        if ($period == 'month') {
            if ($month == '01') {
                //nếu có N3
                $nameRequirement = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] == $year - 1 &&
                            $decoded['thang'] == 4 &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] == $year - 1 &&
                            $decoded['thang'] == 12 &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) use ($year) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                (int)$decoded['nam'] == $year - 1 &&
                                $decoded['thang'] == 12 &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                (int)$decoded['nam'] == $year - 1 &&
                                $decoded['thang'] == 12 &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            } else {
                //nếu có N3
                $nameRequirement = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] == $year &&
                            (int)$decoded['thang'] == $month - 1 &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] == $year &&
                            (int)$decoded['thang'] == $month - 1 &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) use ($year, $month) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                $decoded['nam'] == $year &&
                                (int)$decoded['thang'] == $month - 1 &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                $decoded['nam'] == $year &&
                                (int)$decoded['thang'] == $month - 1 &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            }
        } else if ($period == 'quarter') {
            if ($quarter == '1') {
                //nếu có N3
                $nameRequirement = $data->filter(function ($item) use ($year, $month) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] == $year - 1 &&
                            $decoded['quy'] == 4 &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            (int)$decoded['nam'] == $year - 1 &&
                            $decoded['quy'] == 4 &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) use ($year) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                (int)$decoded['nam'] == $year - 1 &&
                                $decoded['quy'] == 4 &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                (int)$decoded['nam'] == $year - 1 &&
                                $decoded['quy'] == 4 &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            } else {
                //nếu có N3
                $nameRequirement = $data->filter(function ($item) use ($year, $quarter) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] == $year &&
                            (int)$decoded['quy'] == $quarter - 1 &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            $decoded['nam'] == $year &&
                            (int)$decoded['quy'] == $quarter - 1 &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) use ($year, $quarter) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                $decoded['nam'] == $year &&
                                (int)$decoded['quy'] == $quarter - 1 &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                $decoded['nam'] == $year &&
                                (int)$decoded['quy'] == $quarter - 1 &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            }
        } else {
            if ($period == '6-last-month') {
                $dataNew = DB::table('process_requests')
                    ->where('application_id', 73)
                    ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', ['6-first-month'])
                    ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [$year])
                    ->pluck('data');
                //nếu có N3
                $nameRequirement = $dataNew->filter(function ($item) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            } else {
                if ($period == '6-first-month') {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', ['6-last-month'])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(int)($year - 1)])
                        ->pluck('data');
                } else {
                    $dataNew = DB::table('process_requests')
                        ->where('application_id', 73)
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.ky_bc")) = ?', [$typePeriod])
                        ->whereRaw('JSON_UNQUOTE(JSON_EXTRACT(data, "$.nam")) = ?', [(int)($year - 1)])
                        ->pluck('data');
                }

                //nếu có N3
                $nameRequirement = $dataNew->filter(function ($item) {
                    $decoded = json_decode($item, true);
                    if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                        return isset($decoded['loai_dl']) &&
                            $decoded['ktth_vtg_pd'] == 1 &&
                            $decoded['loai_dl'] == 3;
                    } else {
                        return isset($decoded['loai_dl']) &&
                            $decoded['loai_dl'] == 3;
                    }
                });
                //ko có thì kiếm N25
                if ($nameRequirement->isEmpty()) {
                    $nameRequirement = $data->filter(function ($item) {
                        $decoded = json_decode($item, true);
                        if (isset($decoded['ktth_vtg_pd']) && $decoded['ktth_vtg_pd'] == 1) {
                            return isset($decoded['loai_dl']) &&
                                $decoded['ktth_vtg_pd'] == 1 &&
                                $decoded['loai_dl'] == 4;
                        } else {
                            return isset($decoded['loai_dl']) &&
                                $decoded['loai_dl'] == 4;
                        }
                    });
                }
            }
        }

        if ($nameRequirement->isEmpty()) {
            return response()->json([
                'success' => true,
                'data' => 'no report requirement for the selected reporting period.',
            ]);
        }
        $names = $nameRequirement->map(function ($item) {
            $decoded = json_decode($item, true); // Giải mã trực tiếp mỗi phần tử
            return $decoded['name'] ?? null;
        });
        return response()->json([
            'success' => true,
            'data' => $names
        ]);
    }
}
