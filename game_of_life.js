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

    const gl = get_webgl_context("#gameOfLifeCanvas", "webgl2");
    const canvas = document.querySelector("#gameOfLifeCanvas");
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(1.0, 0.0, 0.0, 1.0);
    console.log(`Max texture size ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`);
    const bytes_per_float = Float32Array.BYTES_PER_ELEMENT;

    /////////////////////////////////
    // Game of Life game state
    /////////////////////////////////
    const pixels_per_square = 16;
    const gol_width = Math.floor(canvas.width / pixels_per_square);
    const gol_height = Math.floor(canvas.height / pixels_per_square);
    console.log(`gol_width: ${gol_width} gol_height: ${gol_height}`);

    const num_cells = gol_width * gol_height;
    const x_sections = 4;
    const y_sections = 2;
    const dx = 2.0 / gol_width; // gl screen space
    const dy = 2.0 / gol_height;
    const x_cells_per_section = gol_width / x_sections;
    const y_cells_per_section = gol_height / y_sections;
    const tex_dx = 1.0 / x_cells_per_section;
    const tex_dy = 1.0 / y_cells_per_section;
    console.log(`x_cells_per_section: ${x_cells_per_section} y_cells_per_section: ${y_cells_per_section}`);
    let gol_board = new Array(num_cells).fill(0);

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
        const tex_y = quadrant_y_ind * tex_dy;

        for(let x_ind = 0; x_ind < gol_width; x_ind++){
            const screen_x = -1.0 + x_ind * dx;
            const quadrant_x_ind = Math.floor(x_ind / x_cells_per_section)
            const tex_x = quadrant_x_ind * tex_dx;
            const quadrant_ind = 2.0 * quadrant_y_ind + quadrant_x_ind;
            //console.log(`${screen_x} ${quadrant_ind} ${screen_x} `);

            // bottom left
            // positions
            grid_vertices.push(screen_x);
            grid_vertices.push(screen_y);
            grid_vertices.push(quadrant_ind);
            // texture
            grid_vertices.push(tex_x);
            grid_vertices.push(tex_y);

            // top left
            grid_vertices.push(screen_x);
            grid_vertices.push(screen_y + dy);
            grid_vertices.push(quadrant_ind);
            grid_vertices.push(tex_x);
            grid_vertices.push(tex_y + tex_dy);

            // top right
            grid_vertices.push(screen_x + dx);
            grid_vertices.push(screen_y + dy);
            grid_vertices.push(quadrant_ind);
            grid_vertices.push(tex_x + tex_dx);
            grid_vertices.push(tex_y + tex_dy);

            // bottom right
            grid_vertices.push(screen_x + dx);
            grid_vertices.push(screen_y);
            grid_vertices.push(quadrant_ind);
            grid_vertices.push(tex_x + tex_dx);
            grid_vertices.push(tex_y);
        }
    }

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
        flat out float quadrant_id;

        void main(){
            gl_Position = vec4(a_pos.x, a_pos.y, 0.0, 1.0);
            tex_coords = a_tex_coords;
            quadrant_id = a_pos.z;
        }
    `

    const grid_fragment_source = `#version 300 es
        precision mediump float;
        uniform ivec3 u_grid_resolution;
        uniform ivec2 u_sections;

        flat in float quadrant_id;
        in vec2 tex_coords;
        out vec4 fragColor;

        int get_quadrant_id(){
            ivec2 cell_pos = ivec2(gl_FragCoord.xy) / u_grid_resolution.z;
            ivec2 cells_per_section = u_grid_resolution.xy / u_sections;
            ivec2 inds = cell_pos / cells_per_section;
            return inds.y * u_sections.x + inds.x;
        }

        void main(){
            int this_quadrant_id = get_quadrant_id();

            vec4 dye_color = vec4(1.0);
            vec4 alive_color = vec4(1.0);
            vec4 dead_color = vec4(vec3(0.0), 1.0);
            if(this_quadrant_id == 0){
                dye_color = vec4(1.0, 1.0, 0.0, 1.0);
            }
            else if (this_quadrant_id == 1){
                dye_color = vec4(0.0, 1.0, 0.0, 1.0);
            }
            else if (this_quadrant_id == 2){
                dye_color = vec4(0.0, 0.0, 1.0, 1.0);
            }
            else if (this_quadrant_id == 3){
                dye_color = vec4(0.0, 1.0, 1.0, 1.0);
            }
            else if (this_quadrant_id == 4){
                dye_color = vec4(0.5, 0.5, 0.5, 1.0);
            }
            else if (this_quadrant_id == 5){
                dye_color = vec4(0.5, 1.0, 0.5, 1.0);
            }
            else if (this_quadrant_id == 6){
                dye_color = vec4(0.0, 0.5, 0.5, 1.0);
            }
            else if (this_quadrant_id == 7){
                dye_color = vec4(0.5, 0.5, 1.0, 1.0);
            }
            else{
                dye_color = vec4(0.0, 0.0, 0.0, 1.0)/ 0.2;
            }
            
            fragColor = 0.25 * dye_color;
        }
    `

    const grid_program = create_and_link_shaders(gl, grid_vertex_source, grid_fragment_source);
    gl.useProgram(grid_program);
    const grid_position_attribute_location = gl.getAttribLocation(grid_program, "a_pos");
    const grid_tex_coords_attribute_location = gl.getAttribLocation(grid_program, "a_tex_coords");
    const grid_resolution_location = gl.getUniformLocation(grid_program, "u_grid_resolution");
    const grid_sections_location = gl.getUniformLocation(grid_program, "u_sections");

    gl.uniform3iv(grid_resolution_location, [gol_width, gol_height, pixels_per_square]);
    gl.uniform2iv(grid_sections_location, [x_sections, y_sections]);

    const grid_vao = gl.createVertexArray();
    gl.bindVertexArray(grid_vao);

    const grid_vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, grid_vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grid_vertices), gl.STATIC_DRAW);

    const grid_ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, grid_ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(grid_indices), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(grid_position_attribute_location);
    gl.vertexAttribPointer(grid_position_attribute_location,
        3, gl.FLOAT, false, 5 * bytes_per_float, 0
    );

    gl.enableVertexAttribArray(grid_tex_coords_attribute_location);
    gl.vertexAttribPointer(grid_tex_coords_attribute_location,
        2, gl.FLOAT, false, 5 * bytes_per_float, 3 * bytes_per_float
    );

    function draw_grid(){
        gl.useProgram(grid_program);
        gl.bindVertexArray(grid_vao);
        gl.drawElements(gl.TRIANGLES, 6 * num_cells, gl.UNSIGNED_SHORT, 0)
    }

    /////////////////////////////////
    // Main render loop
    /////////////////////////////////

    function render(){
        gl.clear(gl.COLOR_BUFFER_BIT);
        draw_grid();
        draw_lines();

        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
})();
