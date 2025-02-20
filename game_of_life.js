(function(){
    /////////////////////////////////
    // WebGL Boilerplate
    /////////////////////////////////
    function get_webgl_context(canvas_name, gl_type){
        const canvas = document.querySelector(canvas_name);
        const gl = canvas.getContext(gl_type);
        if (!gl){
            console.log("Couldn't get webgl context");
        }
        return gl;
    }

    function create_shader(gl, type, source){
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success){
            return shader;
        }

        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    function create_program(gl, vertex_shader, fragment_shader){
        const program = gl.createProgram();
        gl.attachShader(program, vertex_shader);
        gl.attachShader(program, fragment_shader);
        gl.linkProgram(program);
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success){
            return program;
        }

        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    }

    function create_and_link_shaders(gl, vertex_shader_source, fragment_shader_source){
        const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
        const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
        const program = create_program(gl, vertex_shader, fragment_shader);
        return program;
    }

    function create_texture(gl){
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

        return texture;
    }
    
    const gl = get_webgl_context("#gameOfLifeCanvas", "webgl2");
    const canvas = document.querySelector("#gameOfLifeCanvas");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    console.log(`Max texture size ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
    console.log(`Max vertices per call ${gl.getParameter(gl.MAX_ELEMENTS_VERTICES)}`);
    const bytes_per_float = Float32Array.BYTES_PER_ELEMENT;

    /////////////////////////////////
    // Game of Life game state
    /////////////////////////////////
    const pixels_per_square = 16;
    const gol_width = Math.floor(canvas.width / pixels_per_square);
    const gol_height = Math.floor(canvas.height / pixels_per_square);
    const num_cells = gol_width * gol_height;
    console.log(`gol_width: ${gol_width} gol_height: ${gol_height} num_cells: ${num_cells}`);

    const x_sections = 8;
    const y_sections = 4;
    const dx = 2.0 / gol_width; // gl screen space
    const dy = 2.0 / gol_height;
    const x_cells_per_section = gol_width / x_sections;
    const y_cells_per_section = gol_height / y_sections;
    const texture_width = x_cells_per_section;
    const texture_height = y_cells_per_section;
    const tex_dx = 1.0 / x_cells_per_section;
    const tex_dy = 1.0 / y_cells_per_section;
    console.log(`x_cells_per_section: ${x_cells_per_section} y_cells_per_section: ${y_cells_per_section}`);
    console.log(`texture_width: ${texture_width} texture_height: ${texture_height} texture bits: ${texture_width * texture_height * 32}`);

    // the very first 32 bits in the array/texture correspond to
    // the bottom left corners of each section, the next 32 
    // correspond to the bottom row second column, so on and so forth
    // the integer to modify corresponds to the offset within the section
    // the bit to modify depends on the section
    let gol_board = new Uint32Array(num_cells/32).fill(0);
    console.log(`gol_board length: ${gol_board.length} gol_board bits: ${gol_board.length * 32}`)

    const gol_kernel = new Int32Array([
        1, 1, 1,
        1, 9, 1,
        1, 1, 1
    ]);

    const normal_kernel = [
        0, 0, 0,
        0, 100, 0,
        0, 0, 0
    ];


    /////////////////////////////////
    // Textures and framebuffers
    /////////////////////////////////

    // textures are RGBA8, so layout on GPU is
    // RRRRRRRR GGGGGGGG BBBBBBBB AAAAAAAA
    // index the y sections by channel, RGBA
    // index the x sections by bit
    // e.g. y = 2, x = 4 bit would be accessed by tex.b && (1 << 4)
    // y in [0, 3], x in [0, 7]
    // texture coordinates choose which 32 bit RGBA value to sample
    const texture = create_texture(gl);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const internal_format = gl.RGBA8;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;

    // x, y are the coordinates of the cell on the board, independent of sectioning
    function set_cell(x, y){
        // in JS array version of board, need to pack bits
        let offset = 0;
        const x_section = Math.floor(x/x_cells_per_section);
        const y_section = Math.floor(y/y_cells_per_section);
        const x_offset = x % x_cells_per_section;
        const y_offset = y % y_cells_per_section;
        const gol_board_index = y_offset * x_cells_per_section + x_offset;
        //console.log(`x ${x} y ${y}`)
        //console.log(`x_section ${x_section} y_section ${y_section}`)
        //console.log(`x_offset ${x_offset} y_offset ${y_offset}`)
        //console.log(`gol_board index: ${gol_board_index}`)
        offset += y_section * 8;
        offset += x_section;

        gol_board[gol_board_index] |= (1 << offset);
    }

    const threshold = 0.5;
    function randomize_board(){
        for(let i = 0; i < num_cells/32; i++){
            for(let j = 0; j < 32; j++){
                const x = Math.random();
                if (x < threshold){
                    gol_board[i] |= 1 << j;
                }
                else{
                    gol_board[i] &= (~(1 << j));
                }
            }
        }
    }

    function buffer_board_to_texture(){
        gl.texImage2D(gl.TEXTURE_2D, 0, internal_format,
                x_cells_per_section, y_cells_per_section, 0,
                format, type, new Uint8Array(gol_board.buffer)
        );
    }

    // alive 3 cells at (x,y) and (x +/- 1, y)
    function horizontal_triplet(x, y){
        set_cell(x,y);
        set_cell(x-1,y);
        set_cell(x+1,y);
    }

    //randomize_board();
    horizontal_triplet(8, 3);
    buffer_board_to_texture();

    /////////////////////////////////
    // Draw gridlines
    /////////////////////////////////

    // to draw a straight line, we need a start and an endpoint
    // in 2D, each point needs an x and y
    // for a straight line of constant y spanning the whole
    // screen, the coords are
    // (x_min, y) and (x_max, y)
    // in opengl screenspace, x_max/x_min are +/-1.0
    let gridline_vertices = [];

    // lines of constant x with y = +/- 1.0
    for(let x = -1.0; x < 1.0; x += dx){
        gridline_vertices.push(x);
        gridline_vertices.push(-1.0);
        gridline_vertices.push(x);
        gridline_vertices.push(1.0);
    }

    for(let y = -1.0; y < 1.0; y += dy){
        gridline_vertices.push(-1.0);
        gridline_vertices.push(y);
        gridline_vertices.push(1.0);
        gridline_vertices.push(y);
    }

    const lines_vertex_source = `#version 300 es
        in vec2 a_pos;

        void main(){
            gl_Position = vec4(a_pos, 0.0, 1.0);
        }
    `

    const lines_fragment_source = `#version 300 es
        precision mediump float;
        out vec4 fragColor;

        void main(){
            fragColor = vec4(0.3, 0.4, 0.0, 1.0);
        }
    `

    const lines_program = create_and_link_shaders(gl, lines_vertex_source, lines_fragment_source);
    gl.useProgram(lines_program);
    const lines_position_attribute_location = gl.getAttribLocation(lines_program, "a_pos");

    const lines_vao = gl.createVertexArray();
    gl.bindVertexArray(lines_vao);

    const lines_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, lines_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridline_vertices), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(lines_position_attribute_location);
    gl.vertexAttribPointer(lines_position_attribute_location,
        2, gl.FLOAT, false, 2*bytes_per_float, 0
    );

    function draw_lines(){
        gl.useProgram(lines_program);
        gl.bindVertexArray(lines_vao);
        gl.drawArrays(gl.LINES, 0, 2 * (gol_width + gol_height));
    }

    /////////////////////////////////
    // draw cells
    /////////////////////////////////

    // organize vertices from bottom to top, left to right
    // render pixels using indices, order vertices BL, TL, TR, BR
    // pixels in the bottom left quadrants will use the texture's 
    // r channel, bottom right g, top left b, top right alpha
    // divide the board into its 4 quadrants
    // the e.g., bottom left cell in each quadrant will have the same
    // texture coordinates, the "bottom left" of the texture
    // we'll use the z coordinate of the position to hold the quadrant
    let grid_vertices = [];
    for(let y_ind = 0; y_ind < gol_height; y_ind++){
        const screen_y = -1.0 + y_ind * dy;
        const quadrant_y_ind = Math.floor(y_ind / y_cells_per_section)
        const quadrant_y_offset = y_ind % y_cells_per_section;
        const tex_y = quadrant_y_offset * tex_dy;

        for(let x_ind = 0; x_ind < gol_width; x_ind++){
            const screen_x = -1.0 + x_ind * dx;
            const quadrant_x_ind = Math.floor(x_ind / x_cells_per_section)
            const quadrant_x_offset = x_ind % x_cells_per_section;
            const tex_x = quadrant_x_offset * tex_dx;

            // bottom left
            // positions
            grid_vertices.push(screen_x);
            grid_vertices.push(screen_y);
            grid_vertices.push(tex_x);
            grid_vertices.push(tex_y);

            // top left
            grid_vertices.push(screen_x);
            grid_vertices.push(screen_y + dy);
            grid_vertices.push(tex_x);
            grid_vertices.push(tex_y + tex_dy);

            // top right
            grid_vertices.push(screen_x + dx);
            grid_vertices.push(screen_y + dy);
            grid_vertices.push(tex_x + tex_dx);
            grid_vertices.push(tex_y + tex_dy);

            // bottom right
            grid_vertices.push(screen_x + dx);
            grid_vertices.push(screen_y);
            grid_vertices.push(tex_x + tex_dx);
            grid_vertices.push(tex_y);
        }
    }

    //console.log(grid_vertices);

    let grid_indices = [];
    for(let i = 0; i < num_cells; i++){
        grid_indices.push(4 * i + 0);
        grid_indices.push(4 * i + 1);
        grid_indices.push(4 * i + 2);
        grid_indices.push(4 * i + 0);
        grid_indices.push(4 * i + 2);
        grid_indices.push(4 * i + 3);
    }

    const grid_vertex_source = `#version 300 es
        in vec3 a_pos;
        in vec2 a_tex_coords;
        out vec2 tex_coords;

        void main(){
            gl_Position = vec4(a_pos.x, a_pos.y, 0.0, 1.0);
            tex_coords = a_tex_coords;
        }
    `

    const grid_fragment_source = `#version 300 es
        precision mediump float;
        uniform ivec3 u_grid_resolution;
        uniform ivec2 u_sections;
        uniform int u_kernel[9];

        in vec2 tex_coords;
        out vec4 fragColor;

        uniform sampler2D u_board;

        // coordinates of cell on global board, spanning 0, gol_width/height
        ivec2 get_cell_coords(ivec2 offset){
            return ivec2(gl_FragCoord.xy) / u_grid_resolution.z + offset;
        }

        // get the section coordinates of this cell with an integer offset
        ivec2 get_section_coord(ivec2 offset){
            ivec2 cell_pos = get_cell_coords(offset);
            ivec2 cells_per_section = u_grid_resolution.xy / u_sections;
            return cell_pos / cells_per_section;
        }

        // get the bit of the cell offset from the current one
        int extract_bit_from_texture(ivec2 offset){
            ivec2 idxs = get_section_coord(offset);
            vec2 one_texel = vec2(1.0) / vec2(textureSize(u_board, 0));
            vec4 board_sample = texture(u_board, tex_coords + one_texel * vec2(offset));

            int red_bits = int(board_sample.r * 255.0);
            int green_bits = int(board_sample.g * 255.0);
            int blue_bits = int(board_sample.b * 255.0);
            int alpha_bits = int(board_sample.a * 255.0);

            int bits;
            if(idxs.y == 0) bits = red_bits;
            else if(idxs.y == 1) bits = green_bits;
            else if(idxs.y == 2) bits = blue_bits;
            else bits = alpha_bits;

            return (bits >> idxs.x) & 1;
        }

        void main(){

            ivec2 this_section_coord = get_section_coord(ivec2(0));
            float dye_strength = 0.25;
            vec4 dye_color = ((this_section_coord.x + this_section_coord.y) & 1) == 1
                            ? vec4(1.0, 1.0, 0.0, 1.0)
                            : vec4(0.0, 1.0, 1.0, 1.0);
            dye_color *= dye_strength;

            vec4 alive_color = vec4(1.0);
            vec4 dead_color = vec4(vec3(0.0), 1.0);

            int this_bit = extract_bit_from_texture(ivec2(0));
            vec4 cell_color = this_bit == 1 ? alive_color : dead_color;

            int sum = 0;
            for(int i = 0; i < 9; i++){
                int dx = -1 + i % 3;
                int dy = -1 + i / 3;
                ivec2 coord = get_section_coord(ivec2(dx, dy));
                sum += u_kernel[i] * extract_bit_from_texture(ivec2(dx, dy));
            }

            fragColor = this_bit * u_kernel[4] == 100 ? cell_color :
                        ((sum == 3 || sum == 11 || sum == 12) ? alive_color : dead_color);
            fragColor += dye_color;
        }
    `

    const grid_program = create_and_link_shaders(gl, grid_vertex_source, grid_fragment_source);
    gl.useProgram(grid_program);
    const grid_position_attribute_location = gl.getAttribLocation(grid_program, "a_pos");
    const grid_tex_coords_attribute_location = gl.getAttribLocation(grid_program, "a_tex_coords");
    const grid_resolution_location = gl.getUniformLocation(grid_program, "u_grid_resolution");
    const grid_sections_location = gl.getUniformLocation(grid_program, "u_sections");
    const grid_kernel_location = gl.getUniformLocation(grid_program, "u_kernel");

    gl.uniform3iv(grid_resolution_location, [gol_width, gol_height, pixels_per_square]);
    gl.uniform2iv(grid_sections_location, [x_sections, y_sections]);

    const grid_vao = gl.createVertexArray();
    gl.bindVertexArray(grid_vao);

    const grid_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, grid_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grid_vertices), gl.STATIC_DRAW);

    const grid_ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid_ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(grid_indices), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(grid_position_attribute_location);
    gl.vertexAttribPointer(grid_position_attribute_location,
        2, gl.FLOAT, false, 4 * bytes_per_float, 0
    );

    gl.enableVertexAttribArray(grid_tex_coords_attribute_location);
    gl.vertexAttribPointer(grid_tex_coords_attribute_location,
        2, gl.FLOAT, false, 4 * bytes_per_float, 2 * bytes_per_float
    );

    function draw_grid(kernel){
        gl.useProgram(grid_program);
        gl.bindVertexArray(grid_vao);
        gl.uniform1iv(grid_kernel_location, kernel);
        gl.drawElements(gl.TRIANGLES, 6 * num_cells, gl.UNSIGNED_INT, 0);
    }

    /////////////////////////////////
    // Main render loop
    /////////////////////////////////

    gl.disable(gl.DEPTH_TEST);
    function render(){
        gl.clear(gl.COLOR_BUFFER_BIT);
        draw_grid(gol_kernel);
        draw_lines();

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
